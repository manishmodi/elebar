"""
Yango Fleet API adapter.

Convention: integrations stay INACTIVE until credentials exist — without the
YANGO_* env vars every endpoint reports unconfigured and no dev traffic can
ever hit the live API (`configured` is False and `_headers()` raises
YangoNotConfigured before any request is built).

Ported from the legacy `yango-client.ts`:

- Endpoints: /v1/parks/driver-profiles/list, /v1/parks/orders/list (cursor
  paginated, date-windowed), /v2/parks/driver-profiles/transactions/list,
  /v2/parks/contractors/supply-hours.
- Auth headers X-Client-ID / X-Park-ID / X-API-Key, with the legacy credential
  auto-correction (swap detection, taxi/park/ prefix normalisation).
- Adaptive rate limiter: the Yango "park" is the whole marketplace, so its
  rate limit is shared and easily tripped. All calls are serialized through a
  process-wide gate with a minimum 400ms spacing; on HTTP 429 the interval
  widens (up to 8s) and the next slot is pushed out by the backoff, then it
  relaxes gently (-25ms per success) back toward the floor.
  NOTE: the legacy limiter paced only request *starts* and let round-trips
  overlap; here the gate is held across the round-trip, fully serializing
  calls. That is strictly gentler on the rate limit (never faster), at the
  cost of some wall-time — acceptable because the slow path runs in Celery,
  not inside an HTTP request.
- Mileage arrives in METERS — callers divide by 1000 for km.
- Timeouts raise YangoTimeout; other transport/API failures raise YangoError.
"""

import logging
import os
import threading
import time
from email.utils import parsedate_to_datetime

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://fleet-api.yango.tech"
TIMEOUT = 30  # seconds per HTTP round-trip
MAX_RETRIES = 4  # additional attempts after a 429

# Adaptive pacing (seconds). 400ms (~2.5 req/s) is the proven floor tuned
# against Yango's undocumented rate ceiling.
MIN_INTERVAL = 0.4
MAX_INTERVAL = 8.0
RELAX_STEP = 0.025


class YangoError(Exception):
    """Any Yango transport or API failure."""


class YangoNotConfigured(YangoError):
    """YANGO_* env credentials are missing — no traffic may be sent."""


class YangoTimeout(YangoError):
    """The Yango API did not answer within TIMEOUT seconds."""


# --- Process-wide adaptive throttle ------------------------------------------

_gate = threading.Lock()
_interval = MIN_INTERVAL  # current spacing between request starts
_next_slot = 0.0  # time.monotonic() before which no request may start


def reset_throttle():
    """Reset pacing to the optimistic floor. Call at the start of a fresh sync
    run so it doesn't inherit a maxed-out interval pegged by a previous
    contended run (the interval only relaxes 25ms per success)."""
    global _interval
    with _gate:
        _interval = MIN_INTERVAL


def _parse_retry_after(header):
    """Parse a Retry-After header (seconds or HTTP-date) into seconds."""
    if not header:
        return None
    try:
        return max(0.0, float(header))
    except ValueError:
        pass
    try:
        target = parsedate_to_datetime(header)
        return max(0.0, target.timestamp() - time.time())
    except (TypeError, ValueError):
        return None


class YangoClient:
    def __init__(self):
        self.client_id = os.environ.get("YANGO_CLIENT_ID", "")
        self.park_id = os.environ.get("YANGO_PARK_ID", "")
        self.api_key = os.environ.get("YANGO_API_KEY", "")
        self.work_rule_id = os.environ.get("YANGO_WORK_RULE_ID", "") or None

    @property
    def configured(self):
        return bool(self.client_id and self.park_id and self.api_key)

    def _resolved_credentials(self):
        """Legacy-faithful robustness: the Client ID must start with
        "taxi/park/" and the Park ID must be the bare UUID; auto-correct
        swapped or partially-prefixed values."""
        client_id, park_id = self.client_id, self.park_id
        if not client_id.startswith("taxi/") and park_id.startswith("taxi/"):
            client_id, park_id = park_id, client_id
        if client_id and not client_id.startswith("taxi/"):
            client_id = f"taxi/park/{client_id}"
        if park_id.startswith("taxi/park/"):
            park_id = park_id.replace("taxi/park/", "")
        return client_id, park_id

    @property
    def resolved_park_id(self):
        return self._resolved_credentials()[1]

    def _headers(self):
        if not self.configured:
            raise YangoNotConfigured("Yango credentials are not configured.")
        client_id, park_id = self._resolved_credentials()
        return {
            "X-Client-ID": client_id,
            "X-Park-ID": park_id,
            "X-API-Key": self.api_key,
            "Accept-Language": "en",
        }

    # --- transport -----------------------------------------------------------

    def _request(self, method, path, *, json_body=None, params=None):
        global _interval, _next_slot
        headers = self._headers()  # raises YangoNotConfigured before any I/O
        url = f"{BASE_URL}{path}"

        for attempt in range(MAX_RETRIES + 1):
            with _gate:
                wait = _next_slot - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    response = requests.request(
                        method, url, json=json_body, params=params,
                        headers=headers, timeout=TIMEOUT,
                    )
                except requests.Timeout as exc:
                    _next_slot = time.monotonic() + _interval
                    raise YangoTimeout(f"Yango API {path} timed out after {TIMEOUT}s") from exc
                except requests.RequestException as exc:
                    _next_slot = time.monotonic() + _interval
                    raise YangoError(f"Yango API {path} request failed: {exc}") from exc

                if response.status_code == 429:
                    # Widen the interval and push every pending call past the
                    # backoff window (the gate is shared, so this holds the
                    # whole fleet off — the legacy "barrier").
                    _interval = min(MAX_INTERVAL, _interval * 1.6 + 0.1)
                    retry_after = _parse_retry_after(response.headers.get("Retry-After"))
                    backoff = retry_after if retry_after is not None else min(MAX_INTERVAL, 0.5 * (2 ** attempt))
                    _next_slot = time.monotonic() + backoff
                    if attempt < MAX_RETRIES:
                        logger.warning(
                            "[Yango] 429 on %s — backing off %.1fs, interval now %dms (attempt %d/%d)",
                            path, backoff, int(_interval * 1000), attempt + 1, MAX_RETRIES,
                        )
                        continue
                    raise YangoError(f"Yango API {path} -> 429: limit exceeded.")

                if not response.ok:
                    _next_slot = time.monotonic() + _interval
                    raise YangoError(f"Yango API {path} -> {response.status_code}: {response.text}")

                # Success: gently relax the interval back toward the floor.
                _interval = max(MIN_INTERVAL, _interval - RELAX_STEP)
                _next_slot = time.monotonic() + _interval
                try:
                    return response.json()
                except ValueError as exc:
                    raise YangoError(f"Yango API {path} returned non-JSON body") from exc

        raise YangoError(f"Yango API {path} -> max retries exceeded")  # pragma: no cover

    def _post(self, path, payload):
        return self._request("POST", path, json_body=payload)

    def _get(self, path, params):
        return self._request("GET", path, params=params)

    # --- endpoints -----------------------------------------------------------

    def get_driver_profiles(self, max_profiles=10_000):
        """All park driver profiles, offset-paginated 500 at a time."""
        park_id = self.resolved_park_id
        profiles = []
        page_size = 500
        offset = 0
        total = None
        while (total is None or offset < total) and len(profiles) < max_profiles:
            data = self._post("/v1/parks/driver-profiles/list", {
                "query": {"park": {"id": park_id}},
                "fields": {
                    "driver_profile": [
                        "id", "first_name", "last_name", "middle_name", "phones",
                        "driver_license", "work_status", "work_rule_id",
                    ],
                },
                "limit": min(page_size, max_profiles - len(profiles)),
                "offset": offset,
            })
            items = []
            for row in data.get("driver_profiles") or []:
                profile = row.get("driver_profile") or {}
                items.append({
                    "id": profile.get("id") or row.get("id") or "",
                    "first_name": profile.get("first_name") or "",
                    "last_name": profile.get("last_name") or "",
                    "middle_name": profile.get("middle_name") or "",
                    "phones": profile.get("phones") or [],
                    "work_status": profile.get("work_status") or "",
                    "work_rule_id": profile.get("work_rule_id") or "",
                })
            profiles.extend(items)
            total = data.get("total") if data.get("total") is not None else len(items)
            offset += len(items)
            if not items:
                break
        return profiles

    def get_orders_for_driver(self, driver_profile_id, date_from, date_to):
        """Orders booked in [date_from, date_to] (ISO datetimes with offset).
        `mileage` is in METERS. Cursor-paginated."""
        park_id = self.resolved_park_id
        orders = []
        cursor = ""
        while True:
            body = {
                "query": {
                    "park": {
                        "id": park_id,
                        "driver_profile": {"id": driver_profile_id},
                        "order": {"booked_at": {"from": date_from, "to": date_to}},
                    },
                },
                "limit": 500,
            }
            if cursor:
                body["cursor"] = cursor
            data = self._post("/v1/parks/orders/list", body)
            for order in data.get("orders") or []:
                # The API returns park-wide rows filtered by driver; keep only
                # this driver's orders (legacy defensive filter).
                order_driver = order.get("driver_profile") or {}
                if order_driver and order_driver.get("id") != driver_profile_id:
                    continue
                orders.append({
                    "id": order.get("id"),
                    "status": order.get("status") or "",
                    "created_at": order.get("created_at") or "",
                    "ended_at": order.get("ended_at"),
                    "price": order.get("price"),
                    "mileage": order.get("mileage"),  # meters — /1000 for km
                    "payment_method": order.get("payment_method"),
                    "category": order.get("category"),
                    "address_from": (order.get("address_from") or {}).get("address"),
                    "cancellation_description": order.get("cancellation_description"),
                })
            cursor = data.get("cursor") or ""
            if not cursor:
                break
        return orders

    def get_transactions_for_driver(self, driver_profile_id, date_from, date_to):
        """Driver transactions with event_at in the window. Cursor-paginated."""
        park_id = self.resolved_park_id
        transactions = []
        cursor = ""
        while True:
            body = {
                "query": {
                    "park": {
                        "id": park_id,
                        "driver_profile": {"id": driver_profile_id},
                        "transaction": {"event_at": {"from": date_from, "to": date_to}},
                    },
                },
                "limit": 1000,
            }
            if cursor:
                body["cursor"] = cursor
            data = self._post("/v2/parks/driver-profiles/transactions/list", body)
            for txn in data.get("transactions") or []:
                transactions.append({
                    "id": txn.get("id"),
                    "event_at": txn.get("event_at"),
                    "category_id": txn.get("category_id") or "",
                    "category_name": txn.get("category_name"),
                    "group_id": txn.get("group_id"),
                    "amount": txn.get("amount") or "0",
                    "currency_code": txn.get("currency_code"),
                    "description": txn.get("description"),
                    "order_id": txn.get("order_id"),
                })
            cursor = data.get("cursor") or ""
            if not cursor:
                break
        return transactions

    def get_supply_hours(self, driver_profile_id, date_from, date_to):
        """Online (supply) seconds for the window; 0 on any API failure —
        legacy behaviour: supply hours are best-effort decoration."""
        try:
            data = self._get("/v2/parks/contractors/supply-hours", {
                "contractor_profile_id": driver_profile_id,
                "period_from": date_from,
                "period_to": date_to,
            })
        except YangoNotConfigured:
            raise
        except YangoError:
            return 0
        return int(data.get("supply_duration_seconds") or data.get("supply_seconds") or 0)

    def get_work_rule_id(self):
        """Work rule id for the fleet's work term. YANGO_WORK_RULE_ID env wins;
        otherwise auto-detect by sampling 100 profiles and taking the most
        common work_rule_id (legacy heuristic)."""
        if self.work_rule_id:
            return self.work_rule_id
        data = self._post("/v1/parks/driver-profiles/list", {
            "query": {"park": {"id": self.resolved_park_id}},
            "fields": {"driver_profile": ["id", "work_rule_id"]},
            "limit": 100,
        })
        counts = {}
        for row in data.get("driver_profiles") or []:
            rule_id = (row.get("driver_profile") or {}).get("work_rule_id")
            if rule_id:
                counts[rule_id] = counts.get(rule_id, 0) + 1
        if not counts:
            raise YangoError("Could not auto-detect Yango work rule ID")
        self.work_rule_id = max(counts, key=counts.get)
        logger.info("[Yango] Auto-detected work_rule_id: %s", self.work_rule_id)
        return self.work_rule_id
