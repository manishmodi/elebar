const BASE = "https://fleet-api.yango.tech";

/**
 * Resolve credentials robustly — the Client ID must start with "taxi/park/"
 * and the Park ID must be just the UUID. If the user stored them swapped,
 * detect and correct automatically.
 */
function resolveCredentials() {
  let clientId = process.env.YANGO_CLIENT_ID ?? "";
  let parkId = process.env.YANGO_PARK_ID ?? "";
  const apiKey = process.env.YANGO_API_KEY ?? "";

  // Auto-swap if they appear to be reversed
  if (!clientId.startsWith("taxi/") && parkId.startsWith("taxi/")) {
    [clientId, parkId] = [parkId, clientId];
  }

  // If clientId is a plain UUID, prepend the taxi/park/ prefix
  if (clientId && !clientId.startsWith("taxi/")) {
    clientId = `taxi/park/${clientId}`;
  }

  // Strip the taxi/park/ prefix from parkId if the user included it
  if (parkId.startsWith("taxi/park/")) {
    parkId = parkId.replace("taxi/park/", "");
  }

  return { clientId, parkId, apiKey };
}

function isConfigured() {
  return !!(process.env.YANGO_CLIENT_ID && process.env.YANGO_API_KEY && process.env.YANGO_PARK_ID);
}

function headers() {
  const { clientId, parkId, apiKey } = resolveCredentials();
  return {
    "X-Client-ID": clientId,
    "X-Park-ID": parkId,
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
    "Accept-Language": "en",
  };
}

const PARK_ID = () => resolveCredentials().parkId;

/**
 * The Yango work_rule_id that corresponds to the "Elebhar" work term.
 * Auto-detected from the API on first call; can be overridden via YANGO_WORK_RULE_ID env var.
 * Confirmed value: e26a3cf21acfe01198d50030487e046b (Elebhar work term).
 */
let _elebharWorkRuleId: string | null = process.env.YANGO_WORK_RULE_ID ?? null;

export async function getElebharWorkRuleId(): Promise<string> {
  if (_elebharWorkRuleId) return _elebharWorkRuleId;

  // Auto-detect by fetching a small sample and picking the most common work_rule_id
  const any = (v: unknown) => v as any;
  const data = any(await postJson("/v1/parks/driver-profiles/list", {
    query: { park: { id: PARK_ID() } },
    fields: { driver_profile: ["id", "work_rule_id"] },
    limit: 100,
  }));

  const counts: Record<string, number> = {};
  for (const d of data.driver_profiles ?? []) {
    const rid = d.driver_profile?.work_rule_id;
    if (rid) counts[rid] = (counts[rid] ?? 0) + 1;
  }

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) throw new Error("Could not auto-detect Elebhar work rule ID");

  _elebharWorkRuleId = top[0];
  console.log(`[Yango] Auto-detected Elebhar work_rule_id: ${_elebharWorkRuleId} (${top[1]}/100 drivers)`);
  return _elebharWorkRuleId;
}

export interface YangoDriverProfile {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  phones?: string[];
  driver_license?: { number?: string };
  work_status?: string;
  work_rule_id?: string;
}

export interface YangoOrder {
  id: string;
  status: string;
  created_at: string;
  ended_at?: string;
  price?: string;
  mileage?: string;  // in METERS from Yango API — divide by 1000 for km
  payment_method?: string;
  category?: string;
  address_from?: string;
  cancellation_description?: string;
}

export interface YangoTransaction {
  id: string;
  event_at: string;
  category_id: string;
  category_name?: string;
  group_id?: string;
  amount: string;
  currency_code?: string;
  description?: string;
  order_id?: string;
}

export interface YangoSupplyHours {
  supply_seconds?: number;
}

const MAX_RETRIES = 4;

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Global request rate limiter.
 *
 * The Yango "park" is the entire marketplace (tens of thousands of drivers), so its
 * rate limit is shared and easily tripped. Bursting many calls in parallel triggers a
 * 429 storm where each failure forces a long backoff — for a fleet of ~24 riders this
 * snowballs past the deployment's 60s HTTP timeout and the whole sync 504s.
 *
 * We pace the rate at which requests START (one slot every `intervalMs`), but let their
 * network round-trips OVERLAP. That keeps us under Yango's per-second ceiling while
 * bounding total wall-time to roughly (calls × interval) instead of
 * (calls × interval + Σ round-trip) — critical for staying inside the 60s budget.
 * The interval adapts: it widens on a 429 and slowly relaxes back toward the floor on
 * success, so we self-tune to whatever budget Yango allows.
 */
// 400ms (~2.5 req/s) is the proven floor tuned against Yango's undocumented rate
// ceiling. The interval may widen beyond this on 429s, then relax back toward it.
const MIN_INTERVAL_MS = 400;
const MAX_INTERVAL_MS = 8_000;
let intervalMs = MIN_INTERVAL_MS;
// Slot-reservation cursor: earliest time the next request may start.
let nextSlotAt = 0;
// Hard barrier (ms epoch): set on a 429 so EVERY request — including ones already
// waiting inside the gate — holds off until it passes. Without this, the sibling calls
// of a per-rider Promise.all that already reserved their slots would fire mid-backoff
// and keep a 429 storm alive.
let barrierUntil = 0;
// Slot acquisition is serialized through this chain so each caller gets a distinct,
// correctly-staggered start time even under concurrent Promise.all fan-out (and so there
// is no thundering-herd burst the moment a backoff barrier lifts). Only the lightweight
// gate is serialized; the fetch runs after acquireSlot() resolves, so the network
// round-trips still overlap and total wall-time stays ~(calls × interval).
let gateChain: Promise<void> = Promise.resolve();

/**
 * Reserve the next launch slot and wait until it's due. Requests are spaced ~intervalMs
 * apart at the START, but their fetches may run concurrently in flight. While waiting we
 * re-check the barrier, so a 429 raised by an in-flight sibling delays us too.
 */
function acquireSlot(): Promise<void> {
  const mine = gateChain.then(async () => {
    const startAt = Math.max(Date.now(), nextSlotAt, barrierUntil);
    for (;;) {
      const target = Math.max(startAt, barrierUntil);
      const wait = target - Date.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    nextSlotAt = Date.now() + intervalMs;
  });
  // Keep the gate alive even if a caller's slot wait is interrupted.
  gateChain = mine.catch(() => {});
  return mine;
}

/** Hold the whole fleet (including already-waiting requests) off for `ms` after a 429. */
function backoffAll(ms: number) {
  barrierUntil = Math.max(barrierUntil, Date.now() + ms);
}

/**
 * Reset the adaptive pacing back to its optimistic floor. Call at the start of a fresh
 * sync run so it doesn't inherit a maxed-out 8s interval pegged by a previous contended
 * run (the interval only relaxes -25ms per success, so it would otherwise stay slow).
 */
export function resetThrottle(): void {
  intervalMs = MIN_INTERVAL_MS;
}

/** Parse a Retry-After header (seconds, or HTTP-date) into milliseconds. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Shared request core. All Yango HTTP traffic goes through here so the rate limiter and
 * 429 handling are applied uniformly to GET and POST calls.
 */
async function request(path: string, init: RequestInit, url: string): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquireSlot();
    const res = await fetch(url, init);

    if (res.status === 429) {
      // Back off the WHOLE fleet: widen the interval and delay every pending request.
      intervalMs = Math.min(MAX_INTERVAL_MS, Math.round(intervalMs * 1.6) + 100);
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const backoff = retryAfter ?? Math.min(MAX_INTERVAL_MS, 500 * 2 ** attempt);
      // The barrier (set above) makes this retry's next acquireSlot() — and every other
      // pending request — wait out the backoff window, so no extra sleep is needed here.
      backoffAll(backoff);
      if (attempt < MAX_RETRIES) {
        console.warn(`[Yango] 429 on ${path} — backing off ${Math.round(backoff / 1000)}s, interval now ${intervalMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        continue;
      }
      throw new Error(`Yango API ${path} → 429: Limit exceeded.`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Yango API ${path} → ${res.status}: ${text}`);
    }

    // Success: gently relax the interval back toward the floor.
    intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs - 25);
    return res.json();
  }
  throw new Error(`Yango API ${path} → max retries exceeded`);
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  }, `${BASE}${path}`);
}

async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  return request(path, { method: "GET", headers: headers() }, `${BASE}${path}?${qs}`);
}

export async function getDriverProfiles(maxProfiles = 10_000): Promise<YangoDriverProfile[]> {
  const profiles: YangoDriverProfile[] = [];
  const PAGE_SIZE = 500;
  let offset = 0;
  let total = Infinity;

  while (offset < total && profiles.length < maxProfiles) {
    const fetchCount = Math.min(PAGE_SIZE, maxProfiles - profiles.length);
    const body: Record<string, unknown> = {
      query: { park: { id: PARK_ID() } },
      fields: {
        driver_profile: ["id", "first_name", "last_name", "middle_name", "phones", "driver_license", "work_status", "work_rule_id"],
      },
      limit: fetchCount,
      offset,
    };

    const data = any(await postJson("/v1/parks/driver-profiles/list", body));
    const items: YangoDriverProfile[] = (data.driver_profiles ?? []).map((d: any) => ({
      id: d.driver_profile?.id ?? d.id ?? "",
      first_name: d.driver_profile?.first_name ?? "",
      last_name: d.driver_profile?.last_name ?? "",
      middle_name: d.driver_profile?.middle_name,
      phones: d.driver_profile?.phones ?? [],
      work_status: d.driver_profile?.work_status,
      work_rule_id: d.driver_profile?.work_rule_id,
    }));

    profiles.push(...items);
    total = data.total ?? items.length;
    offset += items.length;

    if (items.length === 0) break;
  }

  return profiles;
}

export async function getOrdersForDriver(
  driverProfileId: string,
  dateFrom: string,
  dateTo: string,
): Promise<YangoOrder[]> {
  const orders: YangoOrder[] = [];
  let cursor = "";
  do {
    const body: Record<string, unknown> = {
      query: {
        park: {
          id: PARK_ID(),
          driver_profile: { id: driverProfileId },
          order: { booked_at: { from: dateFrom, to: dateTo } },
        },
      },
      limit: 500,
    };
    if (cursor) body["cursor"] = cursor;

    const data = any(await postJson("/v1/parks/orders/list", body));
    // Filter to only this driver's orders (the API returns park-wide results filtered by driver)
    const items: YangoOrder[] = (data.orders ?? [])
      .filter((o: any) => !o.driver_profile || o.driver_profile.id === driverProfileId)
      .map((o: any) => ({
        id: o.id,
        status: o.status ?? "",
        created_at: o.created_at ?? "",
        ended_at: o.ended_at,
        price: o.price,
        mileage: o.mileage,   // in meters — divide by 1000 for km at aggregation time
        payment_method: o.payment_method,
        category: o.category,
        address_from: o.address_from?.address,
        cancellation_description: o.cancellation_description,
      }));
    orders.push(...items);
    cursor = data.cursor ?? "";
  } while (cursor);

  return orders;
}

export async function getTransactionsForDriver(
  driverProfileId: string,
  dateFrom: string,
  dateTo: string,
): Promise<YangoTransaction[]> {
  const txns: YangoTransaction[] = [];
  let cursor = "";
  do {
    const body: Record<string, unknown> = {
      query: {
        park: {
          id: PARK_ID(),
          driver_profile: { id: driverProfileId },
          transaction: { event_at: { from: dateFrom, to: dateTo } },
        },
      },
      limit: 1000,
    };
    if (cursor) body["cursor"] = cursor;

    const data = any(await postJson("/v2/parks/driver-profiles/transactions/list", body));
    const items: YangoTransaction[] = (data.transactions ?? []).map((t: any) => ({
      id: t.id,
      event_at: t.event_at,
      category_id: t.category_id ?? "",
      category_name: t.category_name,
      group_id: t.group_id,
      amount: t.amount ?? "0",
      currency_code: t.currency_code,
      description: t.description,
      order_id: t.order_id,
    }));
    txns.push(...items);
    cursor = data.cursor ?? "";
  } while (cursor);

  return txns;
}

export async function getSupplyHours(
  driverProfileId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  try {
    const data = any(await getJson("/v2/parks/contractors/supply-hours", {
      contractor_profile_id: driverProfileId,
      period_from: dateFrom,
      period_to: dateTo,
    }));
    return data.supply_duration_seconds ?? data.supply_seconds ?? 0;
  } catch {
    return 0;
  }
}

function any(v: unknown): any { return v; }

export { isConfigured };
