---
name: Yango park scale & rate limiting
description: Why Yango sync must stay per-driver and be paced by a global rate limiter; what caused the production 504s.
---

# Yango park scale & rate limiting

## The "park" is the whole marketplace, not the fleet
The Yango park (YANGO_PARK_ID) contains the **entire Yango marketplace** — verified live: ~17,315 driver profiles, 3,000+ orders **per day**. The Elebhar fleet is only ~24–30 *linked* riders, a tiny slice. Never assume park ≈ fleet.

## Park-wide endpoints are NOT viable — sync must stay per-driver
Probed against the live API (`fleet-api.yango.tech`):
- `/v1/parks/orders/list` **can** omit the driver filter (each order carries `driver_profile.id`), BUT the park-wide response **omits `mileage`** (needed for distance) and returns thousands of rows across many pages → heavy + rate-limited.
- `/v2/parks/driver-profiles/transactions/list` **requires** `query.park.driver_profile` — returns HTTP 400 without it. Cannot go park-wide at all.
- `/v2/parks/contractors/supply-hours` takes a single `contractor_profile_id`; no bulk variant.

**Conclusion:** keep the per-driver fan-out (orders + same-day txns + next-day txns + supply-hours). A "fetch everything once" park-wide refactor is a dead end here.

## Root cause of the production 504 on /api/yango/sync/preview
The deployment proxy kills any HTTP request after ~60s. The per-rider sync fired 4 parallel calls per rider against Yango's shared park rate limit (~2.5 req/s), triggering a 429 storm; the old client waited a flat 15s per 429 → snowballed to ~5 min for ~24 riders → 504. The frontend then tried to `JSON.parse("upstream request timeout")` → "Unexpected token 'u'…".

## The fix (global rate limiter, in yango-client.ts)
Pace the rate at which requests **START** (one slot every ~400ms via `acquireSlot()`/`nextSlotAt`) but let round-trips **overlap**. This bounds wall-time to ~(calls × interval) instead of (calls × interval + Σ RTT) — a serial one-at-a-time queue is the wrong model because RTT stacks on top and can still breach 60s. Interval is adaptive: widens ×1.6 on 429 (cap 8s, honors Retry-After), relaxes −25ms on success; floor 400ms (proven value from the sibling rider-club system).

**Why 400ms floor:** tuned against Yango's undocumented ~2.5 req/s ceiling (learned by the other production system, confirmed by 429 probes here).

## Durable constraint for future scaling
The preview/sync runs **synchronously inside the HTTP request**, so it is fundamentally bounded by the 60s proxy timeout. The paced limiter keeps ~24 riders well under that, but a much larger fleet will eventually need a **background-job model** (job table + mutex + polling + two-pass retry), exactly like the sibling "elebhar-rider-club" nightly cron. That sibling system's patterns (idempotent writes keyed on external ID, one call per window, recompute-from-ledger) are the reference if/when this is moved off the request path.

## Background-job model (shipped) — preview no longer runs in the request
The synchronous preview was moved off the HTTP request path because throttling alone
could NOT beat the shared-park 429s: production logs showed the adaptive interval pegging
at its 8s max and the run taking 6+ minutes, 504ing every time. The pacing fix is
necessary but insufficient on its own against this contention.

Design: POST /yango/sync/preview/start kicks off an in-memory **single-flight** job
(only one at a time — repeated clicks attach to the in-flight job instead of multiplying
load on the park) and returns a job id immediately; the UI polls
GET /yango/sync/preview/status/:id every 2s for progress + final result. previewForDate
takes an onProgress callback. resetThrottle() is called at job start so a fresh run starts
optimistic instead of inheriting a pegged 8s interval (the limiter only relaxes -25ms per
success, so it would otherwise stay slow for the whole next run).

**Why single-flight matters:** without it, each timed-out client retry left the server
still grinding AND spawned another concurrent full sync — self-amplifying the 429 storm.
