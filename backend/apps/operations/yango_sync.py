"""
Yango sync engine — pulls per-rider-day figures from the Yango Fleet API and
stages them as DRAFT DailyLog rows for ops to confirm.

Ported from the legacy `yango-sync.ts` / `yango-jobs.ts` /
`yango-driver-cache.ts`, expressed in Django/Celery idioms:

- Day windows are Nepal-local (ORG_TIMEZONE, +05:45) ISO ranges.
- Goal bonus for a work day is posted by Yango in the NEXT day's statement:
  next-day `platform_bonus` transactions with NO order_id (batch payout).
  Promo/other = `platform_promotion` + same-day `platform_bonus` WITH an
  order_id (per-trip bonuses). App cash = `cash_collected` transaction sum
  (more accurate than summing order prices).
- Draft-only writes: a DailyLog where is_draft=False is NEVER overwritten.
- Preview jobs run in Celery and publish progress/result into the Django
  cache (works eagerly in dev, async in prod). Single-flight: one preview at
  a time; re-requesting the SAME date attaches to the running job, a
  DIFFERENT date is a conflict.
- The legacy in-process driver cache became a Django-cache entry with a TTL.

All money is Decimal end-to-end; cached previews serialize money as strings.
"""

import logging
import uuid as uuid_lib
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.fleet.models import Assignment, Vehicle
from apps.riders.models import Rider

from .models import DailyLog
from .yango import YangoClient, reset_throttle

logger = logging.getLogger(__name__)

TWO_PLACES = Decimal("0.01")


# --- Nepal day helpers --------------------------------------------------------

def _org_tz():
    return ZoneInfo(getattr(settings, "ORG_TIMEZONE", "Asia/Kathmandu"))


def nepal_day_range(day):
    """ISO start/end timestamps for a Nepal-local calendar day
    (e.g. 2026-07-18T00:00:00+05:45 .. 2026-07-18T23:59:59+05:45)."""
    tz = _org_tz()
    start = datetime.combine(day, time(0, 0, 0), tzinfo=tz)
    end = datetime.combine(day, time(23, 59, 59), tzinfo=tz)
    return start.isoformat(), end.isoformat()


def today_nepal():
    return timezone.now().astimezone(_org_tz()).date()


def yesterday_nepal():
    return today_nepal() - timedelta(days=1)


# --- Pure aggregation ---------------------------------------------------------

def _dec(value):
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return Decimal("0")


def format_supply_hours(supply_seconds):
    """Seconds -> "H:MM" ("" when zero), matching the legacy display format."""
    if not supply_seconds or supply_seconds <= 0:
        return ""
    return f"{supply_seconds // 3600}:{(supply_seconds % 3600) // 60:02d}"


def aggregate_rider_day(orders, transactions, next_day_transactions, supply_seconds):
    """Fold one rider-day of raw Yango data into DailyLog figures.

    Pure and unit-testable. Returns None when the rider had no activity
    (no orders AND no online time) — such days are skipped entirely.
    Money values are Decimal; distance is a 2dp string (CharField on the model).
    """
    if not orders and not supply_seconds:
        return None

    completed = [o for o in orders if o.get("status") == "complete"]
    rides_completed = len(completed)
    total_rides_received = len(orders)
    acceptance_rate = (
        f"{(rides_completed / total_rides_received) * 100:.1f}" if total_rides_received else ""
    )

    # Yango returns mileage in METERS — convert to km.
    distance_km = (
        sum((_dec(o.get("mileage")) for o in completed), Decimal("0")) / Decimal("1000")
    ).quantize(TWO_PLACES)
    total_income = sum((_dec(o.get("price")) for o in completed), Decimal("0")).quantize(TWO_PLACES)

    # App cash: Yango's cash_collected transaction sum.
    cash_as_per_app = sum(
        (_dec(t.get("amount")) for t in transactions if t.get("group_id") == "cash_collected"),
        Decimal("0"),
    ).quantize(TWO_PLACES)

    # Promo & others: platform_promotion + same-day per-trip platform_bonus
    # (order_id set). Goal-bonus batch payouts have NO order_id and must NOT
    # be counted here.
    promotion_bonus_other = sum(
        (
            _dec(t.get("amount"))
            for t in transactions
            if t.get("group_id") == "platform_promotion"
            or (t.get("group_id") == "platform_bonus" and t.get("order_id"))
        ),
        Decimal("0"),
    ).quantize(TWO_PLACES)

    # Goal bonus: NEXT day's platform_bonus entries with NO order_id.
    goal_bonus = sum(
        (
            _dec(t.get("amount"))
            for t in next_day_transactions
            if t.get("group_id") == "platform_bonus" and not t.get("order_id")
        ),
        Decimal("0"),
    ).quantize(TWO_PLACES)

    return {
        "rides_completed": rides_completed,
        "total_rides_received": total_rides_received,
        "acceptance_rate": acceptance_rate,
        "total_ride_distance_km": str(distance_km),
        "total_income": total_income,
        "cash_as_per_app": cash_as_per_app,
        "goal_bonus": goal_bonus,
        "promotion_bonus_other": promotion_bonus_other,
        "total_app_online": format_supply_hours(supply_seconds),
    }


def fetch_rider_day(client, driver_profile_id, day):
    """Pull orders + transactions (this day AND next day, for the goal bonus)
    + supply hours, then aggregate. The legacy code fired these four calls in
    parallel; our client serializes all traffic anyway, so sequential calls
    are equivalent."""
    date_from, date_to = nepal_day_range(day)
    bonus_from, bonus_to = nepal_day_range(day + timedelta(days=1))
    orders = client.get_orders_for_driver(driver_profile_id, date_from, date_to)
    transactions = client.get_transactions_for_driver(driver_profile_id, date_from, date_to)
    next_day_transactions = client.get_transactions_for_driver(driver_profile_id, bonus_from, bonus_to)
    supply_seconds = client.get_supply_hours(driver_profile_id, date_from, date_to)
    return aggregate_rider_day(orders, transactions, next_day_transactions, supply_seconds)


# --- Persistence --------------------------------------------------------------

def _linked_riders(rider_uuids=None):
    """Active riders linked to a Yango driver profile, optionally scoped to
    specific rider UUIDs (absent/empty => all linked riders)."""
    qs = Rider.objects.filter(status=Rider.Status.ACTIVE).exclude(yango_driver_id="")
    if rider_uuids:
        qs = qs.filter(uuid__in=rider_uuids)
    return list(qs.order_by("full_name"))


def _vehicle_for(rider):
    """The rider's active-assignment vehicle, else any active vehicle
    (legacy fallback so a draft log can always be staged)."""
    assignment = (
        Assignment.objects.filter(rider=rider, status=Assignment.Status.ACTIVE)
        .select_related("vehicle")
        .order_by("-id")
        .first()
    )
    if assignment:
        return assignment.vehicle
    return Vehicle.objects.filter(status=Vehicle.Status.ACTIVE).order_by("id").first()


def _persist_rider_day(rider, day, figures, result):
    """Create/update the draft DailyLog for one rider-day. NEVER overwrites a
    confirmed (is_draft=False) row."""
    fields = {
        # Legacy stored 0 as NULL for the two counters — kept for parity.
        "rides_completed": figures["rides_completed"] or None,
        "total_rides_received": figures["total_rides_received"] or None,
        "acceptance_rate": figures["acceptance_rate"],
        "total_ride_distance_km": figures["total_ride_distance_km"],
        "total_income": figures["total_income"],
        "cash_as_per_app": figures["cash_as_per_app"],
        "goal_bonus": figures["goal_bonus"],
        "promotion_bonus_other": figures["promotion_bonus_other"],
        "total_app_online": figures["total_app_online"],
        "yango_synced_at": timezone.now(),
    }
    existing = DailyLog.objects.filter(rider=rider, english_date=day).first()
    if existing:
        if not existing.is_draft:
            result["skipped"] += 1
            return
        for name, value in fields.items():
            setattr(existing, name, value)
        existing.save(update_fields=list(fields))
        result["updated"] += 1
        return

    vehicle = _vehicle_for(rider)
    if vehicle is None:
        result["errors"].append(f"No vehicle found for rider {rider.full_name} — skipping")
        result["skipped"] += 1
        return
    DailyLog.objects.create(rider=rider, vehicle=vehicle, english_date=day, is_draft=True, **fields)
    result["created"] += 1


def _new_result(day):
    return {"date": day.isoformat(), "processed": 0, "created": 0, "updated": 0,
            "skipped": 0, "errors": []}


def sync_for_date(day, rider_uuids=None):
    """Slow path (cron/manual): fetch from Yango for every linked rider and
    persist draft logs. Returns a counts dict."""
    started = timezone.now()
    result = _new_result(day)
    client = YangoClient()
    if not client.configured:
        result["errors"].append("Yango integration is not configured.")
        return result
    riders = _linked_riders(rider_uuids)
    if not riders:
        result["errors"].append("No riders linked to Yango driver profiles yet")
        return result

    reset_throttle()
    for rider in riders:
        result["processed"] += 1
        try:
            figures = fetch_rider_day(client, rider.yango_driver_id, day)
            if figures is None:
                result["skipped"] += 1
                logger.info("[Yango Sync] Skipping %s — no activity on %s", rider.full_name, day)
                continue
            _persist_rider_day(rider, day, figures, result)
        except Exception as exc:  # per-rider isolation, matching legacy
            result["errors"].append(f"Rider {rider.full_name}: {exc}")
    logger.info(
        "[Yango Sync] %s — processed: %d, created: %d, updated: %d, skipped: %d, errors: %d (took %.1fs)",
        day, result["processed"], result["created"], result["updated"], result["skipped"],
        len(result["errors"]), (timezone.now() - started).total_seconds(),
    )
    return result


# --- Preview ------------------------------------------------------------------

def _figures_to_strings(figures):
    """Cache/JSON-safe copy of aggregate figures (Decimal -> str)."""
    out = dict(figures)
    for key in ("total_income", "cash_as_per_app", "goal_bonus", "promotion_bonus_other"):
        out[key] = str(out[key])
    return out


def preview_for_date(day, rider_uuids=None, on_progress=None):
    """Fetch Yango data for linked riders WITHOUT writing to the DB.
    Returns {"date", "riders": [entry...]}; riders with no activity are
    omitted (legacy behaviour). Caller must have checked `configured`."""
    started = timezone.now()
    client = YangoClient()
    riders = _linked_riders(rider_uuids)
    entries = []
    total = len(riders)
    completed = 0
    if on_progress:
        on_progress(0, total)

    reset_throttle()
    for rider in riders:
        entry = {
            "rider_id": str(rider.uuid),
            "rider_name": rider.full_name,
            "yango_driver_id": rider.yango_driver_id,
            "status": "new",
        }
        try:
            existing = DailyLog.objects.filter(rider=rider, english_date=day).first()
            if existing:
                entry["existing_log_id"] = str(existing.uuid)
                entry["status"] = "draft_exists" if existing.is_draft else "finalized_exists"
                if not existing.is_draft:
                    # Confirmed log — report it but never refetch/overwrite.
                    entries.append(entry)
                    completed += 1
                    if on_progress:
                        on_progress(completed, total)
                    continue
            figures = fetch_rider_day(client, rider.yango_driver_id, day)
            if figures is None:
                logger.info("[Yango Preview] Skipping %s — no activity on %s", rider.full_name, day)
                completed += 1
                if on_progress:
                    on_progress(completed, total)
                continue
            entry.update(_figures_to_strings(figures))
        except Exception as exc:
            entry["status"] = "error"
            entry["error"] = str(exc)
        entries.append(entry)
        completed += 1
        if on_progress:
            on_progress(completed, total)

    logger.info(
        "[Yango Preview] %s — %d riders with activity (took %.1fs)",
        day, len(entries), (timezone.now() - started).total_seconds(),
    )
    return {"date": day.isoformat(), "riders": entries}


def persist_from_preview(day, entries):
    """Persist already-computed preview figures WITHOUT re-hitting the
    rate-limited Yango API. Figures come from the server-side cached preview
    job (never from the client), but riders are still re-validated as active
    and confirmed logs are still never overwritten."""
    result = _new_result(day)
    by_uuid = {
        str(r.uuid): r
        for r in Rider.objects.filter(status=Rider.Status.ACTIVE)
    }
    for entry in entries:
        if entry.get("status") in ("error", "finalized_exists"):
            result["skipped"] += 1
            continue
        rider = by_uuid.get(str(entry.get("rider_id")))
        if rider is None:
            result["skipped"] += 1
            result["errors"].append(
                f"Rider {entry.get('rider_name') or entry.get('rider_id')}: not an active rider — skipped"
            )
            continue
        result["processed"] += 1
        figures = {
            "rides_completed": int(entry.get("rides_completed") or 0),
            "total_rides_received": int(entry.get("total_rides_received") or 0),
            "acceptance_rate": entry.get("acceptance_rate") or "",
            "total_ride_distance_km": entry.get("total_ride_distance_km") or "0.00",
            "total_income": _dec(entry.get("total_income")).quantize(TWO_PLACES),
            "cash_as_per_app": _dec(entry.get("cash_as_per_app")).quantize(TWO_PLACES),
            "goal_bonus": _dec(entry.get("goal_bonus")).quantize(TWO_PLACES),
            "promotion_bonus_other": _dec(entry.get("promotion_bonus_other")).quantize(TWO_PLACES),
            "total_app_online": entry.get("total_app_online") or "",
        }
        try:
            _persist_rider_day(rider, day, figures, result)
        except Exception as exc:
            result["errors"].append(f"Rider {rider.full_name}: {exc}")
    logger.info(
        "[Yango Sync] %s (from preview) — processed: %d, created: %d, updated: %d, skipped: %d, errors: %d",
        day, result["processed"], result["created"], result["updated"], result["skipped"],
        len(result["errors"]),
    )
    return result


# --- Preview jobs (Celery + cache) --------------------------------------------
#
# The Yango park is the whole marketplace and rate-limits hard, so a full
# preview can take minutes — far longer than an HTTP request should live.
# The job runs as a Celery task that writes its state into the Django cache;
# the UI polls. In dev (CELERY_TASK_ALWAYS_EAGER) the task runs inline and
# the first status poll already sees the terminal state.

PREVIEW_JOB_KEY = "yango:preview:job:{job_id}"
PREVIEW_RUNNING_KEY = "yango:preview:running"
PREVIEW_RUNNING_TTL = 60 * 60  # safety valve if a worker dies mid-job
PREVIEW_DONE_TTL = 10 * 60  # legacy retention for finished jobs


def get_preview_job(job_id):
    return cache.get(PREVIEW_JOB_KEY.format(job_id=job_id))


def save_preview_job(job):
    ttl = PREVIEW_RUNNING_TTL if job["status"] == "running" else PREVIEW_DONE_TTL
    cache.set(PREVIEW_JOB_KEY.format(job_id=job["id"]), job, ttl)


def clear_running_marker(job_id):
    if cache.get(PREVIEW_RUNNING_KEY) == job_id:
        cache.delete(PREVIEW_RUNNING_KEY)


def start_preview_job(day, rider_uuids=None):
    """Start (or attach to) a background preview job.

    Returns (job, conflict): conflict=True means a job for a DIFFERENT date is
    running — the view turns that into a 409 so two dates can't be confused.
    A request for the SAME date attaches to the in-flight job.
    """
    running_id = cache.get(PREVIEW_RUNNING_KEY)
    if running_id:
        running = get_preview_job(running_id)
        if running and running["status"] == "running":
            return running, running["date"] != day.isoformat()
        clear_running_marker(running_id)  # stale marker from a dead worker

    job = {
        "id": str(uuid_lib.uuid4()),
        "date": day.isoformat(),
        "status": "running",
        "total": 0,
        "completed": 0,
        "started_at": timezone.now().isoformat(),
    }
    save_preview_job(job)
    cache.set(PREVIEW_RUNNING_KEY, job["id"], PREVIEW_RUNNING_TTL)

    from .tasks import run_yango_preview  # local import: tasks.py imports this module

    run_yango_preview.delay(job["id"], day.isoformat(), rider_uuids)
    # In eager mode the task already finished — return the fresh state.
    return get_preview_job(job["id"]) or job, False


# --- Driver directory cache ---------------------------------------------------
#
# The legacy boot-time in-process cache became a Django-cache entry with a TTL:
# POST /api/yango/drivers/refresh/ re-pulls the park's driver list (working
# drivers only) via the refresh_driver_cache Celery task.

DRIVER_CACHE_KEY = "yango:drivers"
DRIVER_CACHE_STATE_KEY = "yango:drivers:state"
DRIVER_CACHE_TTL = 24 * 60 * 60  # legacy refreshed daily


def refresh_driver_cache_now():
    """Pull the full driver list from Yango into the cache. Clean no-op when
    unconfigured. Returns the cache state dict."""
    client = YangoClient()
    if not client.configured:
        return {"ready": False, "loading": False, "total": 0, "loaded_at": None,
                "error": "Yango integration is not configured."}
    state = {"ready": False, "loading": True, "total": 0, "loaded_at": None, "error": None}
    cache.set(DRIVER_CACHE_STATE_KEY, state, DRIVER_CACHE_TTL)
    try:
        profiles = client.get_driver_profiles()
        drivers = [
            {
                "driver_profile_id": p["id"],
                "name": " ".join(filter(None, [p["first_name"], p["middle_name"], p["last_name"]])),
                "phones": p["phones"],
            }
            for p in profiles
            if p.get("work_status") == "working"
        ]
        cache.set(DRIVER_CACHE_KEY, drivers, DRIVER_CACHE_TTL)
        state = {"ready": True, "loading": False, "total": len(drivers),
                 "loaded_at": timezone.now().isoformat(), "error": None}
    except Exception as exc:
        logger.error("[Yango Cache] Driver refresh failed: %s", exc)
        state = {"ready": cache.get(DRIVER_CACHE_KEY) is not None, "loading": False,
                 "total": len(cache.get(DRIVER_CACHE_KEY) or []),
                 "loaded_at": None, "error": str(exc)}
    cache.set(DRIVER_CACHE_STATE_KEY, state, DRIVER_CACHE_TTL)
    return state


def get_driver_cache():
    """(drivers, state) currently in cache — never triggers network I/O."""
    drivers = cache.get(DRIVER_CACHE_KEY) or []
    state = cache.get(DRIVER_CACHE_STATE_KEY) or {
        "ready": False, "loading": False, "total": 0, "loaded_at": None, "error": None,
    }
    return drivers, state


def search_drivers(query, drivers):
    """Case-insensitive name/phone/id substring search, capped at 50 rows."""
    lowered = query.lower()
    return [
        d for d in drivers
        if lowered in d["name"].lower()
        or any(lowered in phone for phone in d["phones"])
        or lowered in d["driver_profile_id"]
    ][:50]
