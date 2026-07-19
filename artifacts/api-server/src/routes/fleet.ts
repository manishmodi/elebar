import express, { Router, type IRouter, type Request } from "express";
import { and, eq, ne, like, desc, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  ridersTable,
  vehiclesTable,
  assignmentsTable,
  dailyLogsTable,
  attendanceTable,
  cashCollectionsTable,
  fleetHandoversTable,
  payConfigTable,
  payRecordsTable,
  streaksTable,
  salaryAdvancesTable,
  type FleetHandover,
} from "@workspace/db";
import { requireServiceAuth, type FleetRequest } from "../middlewares/service-auth";
import { requirePermission } from "../middlewares/auth";
import { objectStorage } from "../lib/objectStorage";
import { getTodayNepal, previewForDate, persistFromPreview } from "../lib/yango-sync.js";
import { isConfigured } from "../lib/yango-client.js";
import { logActivity } from "../lib/activity-logger";
import { computeDay, goalTiersFor, dayTargetFor, bonusEstimateFor, getPayParams } from "../lib/pay-engine";

/**
 * /api/fleet/v1 — service-token API consumed by the Riders Club backend.
 * Contract: FLEET-INTEGRATION-BRIEF.md in the elebhar-rider-club repo. v1 is
 * frozen once shipped — additive changes only; breaking changes go to /v2.
 *
 * Bodies are validated with hand-written zod (NOT the OpenAPI-generated
 * schemas) so unknown-field stripping can never silently drop data.
 */

const router: IRouter = Router();
const tokenOnly = requireServiceAuth({ riderScoped: false });
const riderScoped = requireServiceAuth({ riderScoped: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function isFleetEnabled(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(payConfigTable)
    .where(and(eq(payConfigTable.parameter, "fleet_enabled"), lte(payConfigTable.effectiveFrom, getTodayNepal())))
    .orderBy(desc(payConfigTable.effectiveFrom))
    .limit(1);
  // Absent config = enabled: exposure is already gated per-rider by fleet_pilot,
  // so a missing row must not brick the pilot; the kill switch is an override.
  return row ? row.value === "true" : true;
}

function requiredIdempotencyKey(req: Request): string | null {
  const key = req.header("x-idempotency-key")?.trim();
  return key && key.length >= 8 && key.length <= 128 ? key : null;
}

async function findByIdempotencyKey(key: string): Promise<FleetHandover | undefined> {
  const [row] = await db.select().from(fleetHandoversTable).where(eq(fleetHandoversTable.idempotencyKey, key));
  return row;
}

async function todaysHandovers(riderId: number, date: string): Promise<FleetHandover[]> {
  return db
    .select()
    .from(fleetHandoversTable)
    .where(
      and(
        eq(fleetHandoversTable.riderId, riderId),
        eq(fleetHandoversTable.englishDate, date),
        ne(fleetHandoversTable.status, "rejected"),
      ),
    )
    .orderBy(fleetHandoversTable.id);
}

function shiftStateOf(handovers: FleetHandover[]): string {
  const checkout = handovers.find((h) => h.kind === "checkout");
  const checkin = handovers.find((h) => h.kind === "checkin");
  if (!checkout) return "not_started";
  if (checkout.status === "pending") return "pending_checkout";
  if (checkin) return checkin.status === "pending" ? "pending_checkin" : "closed";
  return "active";
}

/** Resolve a vehicle by id or by QR payload (vehicle number or plate). */
async function resolveVehicle(vehicleId?: number, vehicleQr?: string) {
  if (vehicleId != null) {
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    return v;
  }
  if (vehicleQr) {
    const qr = vehicleQr.trim();
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vehicleNumber, qr));
    if (v) return v;
    const [byPlate] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.plateNumber, qr));
    return byPlate;
  }
  return undefined;
}

const num = (s: string | null | undefined) => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : null;
};

// ─── Live today-sync ─────────────────────────────────────────────────────────
// Mirrors the Riders Club's points pattern: a /today request pulls THIS ONE
// rider's same-day stats from Yango (the per-rider scoped sync) and upserts
// the day's DRAFT log, so the rider's pull-to-refresh shows live rides/cash/
// pay-projection. Ops is untouched: drafts only (a human-confirmed log is
// never rewritten), and the next-day manual sync/confirm flow works as before.

const LIVE_SYNC_COOLDOWN_MS = 3 * 60 * 1000; // per-rider; keeps ≤30 pilots far under Yango rate limits
const LIVE_SYNC_WAIT_MS = 6000; // serve stale rather than hang /today; sync finishes in background
const lastLiveSync = new Map<number, number>();

async function ensureFreshTodayLog(riderId: number, date: string): Promise<void> {
  if (!isConfigured()) return;
  try {
    const [log] = await db
      .select({ isDraft: dailyLogsTable.isDraft, syncedAt: dailyLogsTable.yangoSyncedAt })
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.riderId, riderId), eq(dailyLogsTable.englishDate, date)));
    if (log && !log.isDraft) return; // human-confirmed — never touch

    const freshAt = log?.syncedAt ? new Date(log.syncedAt).getTime() : 0;
    const last = Math.max(lastLiveSync.get(riderId) ?? 0, freshAt);
    if (Date.now() - last < LIVE_SYNC_COOLDOWN_MS) return;
    lastLiveSync.set(riderId, Date.now()); // set BEFORE the fetch so concurrent polls don't stampede

    const work = (async () => {
      const preview = await previewForDate(date, undefined, [riderId]);
      await persistFromPreview(date, preview.riders);
    })().catch((err: unknown) => {
      console.error("[fleet] live today-sync failed (non-fatal):", err instanceof Error ? err.message : err);
    });
    // Wait briefly for a fast Yango answer; otherwise respond with what we
    // have — the background sync lands for the app's next poll (~45s).
    await Promise.race([work, new Promise((res) => setTimeout(res, LIVE_SYNC_WAIT_MS))]);
  } catch (err) {
    console.error("[fleet] live today-sync guard failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const odometer = z.number().int().positive();
const batteryPct = z.number().int().min(0).max(100);
const photoPaths = z.record(z.string(), z.string().startsWith("/objects/")).optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

const CheckoutBody = z.object({
  date: dateStr,
  vehicleId: z.number().int().positive().optional(),
  vehicleQr: z.string().min(1).optional(),
  odometerOut: odometer,
  batteryOutPct: batteryPct,
  goalTier: z.number().int().positive(),
  photoPaths,
});

const ExchangeBody = z.object({
  date: dateStr,
  closing: z.object({ odometer, batteryPct, photoPaths }),
  reason: z.enum(["battery_low", "breakdown", "puncture", "other"]),
  reasonNote: z.string().max(500).optional(),
  opening: z.object({
    vehicleId: z.number().int().positive().optional(),
    vehicleQr: z.string().min(1).optional(),
    odometer,
    batteryPct,
    photoPaths,
  }),
});

const CheckinBody = z.object({
  date: dateStr,
  odometerIn: odometer,
  batteryInPct: batteryPct,
  cashDeclared: z.number().min(0),
  walletDeclared: z.number().min(0),
  photoPaths,
});

// ─── GET /fleet/v1/pilots ────────────────────────────────────────────────────

router.get("/fleet/v1/pilots", tokenOnly, async (_req, res): Promise<void> => {
  const [enabled, pilots] = await Promise.all([
    isFleetEnabled(),
    db
      .select({ yangoDriverId: ridersTable.yangoDriverId, riderId: ridersTable.id, fullName: ridersTable.fullName })
      .from(ridersTable)
      .where(and(eq(ridersTable.fleetPilot, true), eq(ridersTable.status, "active"))),
  ]);
  res.json({ fleetEnabled: enabled, pilots: pilots.filter((p) => p.yangoDriverId) });
});

// ─── GET /fleet/v1/today ─────────────────────────────────────────────────────

router.get("/fleet/v1/today", riderScoped, async (req, res): Promise<void> => {
  const rider = (req as FleetRequest).fleetRider!;
  const date = getTodayNepal();
  const month = date.slice(0, 7);

  // Live same-day Yango pull (throttled per rider) so refresh shows real
  // progress instead of "not available yet" all day.
  await ensureFreshTodayLog(rider.id, date);

  const [enabled, handovers, [assignment], [log], [streak], lockedRecords, [att]] = await Promise.all([
    isFleetEnabled(),
    todaysHandovers(rider.id, date),
    db
      .select({ vehicleId: assignmentsTable.vehicleId, plate: vehiclesTable.plateNumber, model: vehiclesTable.model })
      .from(assignmentsTable)
      .leftJoin(vehiclesTable, eq(assignmentsTable.vehicleId, vehiclesTable.id))
      .where(and(eq(assignmentsTable.riderId, rider.id), eq(assignmentsTable.status, "active")))
      .orderBy(desc(assignmentsTable.id))
      .limit(1),
    db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.riderId, rider.id), eq(dailyLogsTable.englishDate, date))),
    db.select().from(streaksTable).where(eq(streaksTable.riderId, rider.id)),
    db
      .select()
      .from(payRecordsTable)
      .where(
        and(
          eq(payRecordsTable.riderId, rider.id),
          eq(payRecordsTable.status, "locked"),
          like(payRecordsTable.englishDate, `${month}%`),
        ),
      ),
    db
      .select({ riderTimeIn: attendanceTable.riderTimeIn })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.riderId, rider.id), eq(attendanceTable.date, date))),
  ]);

  // ONE clock: the live shift clock reads attendance.riderTimeIn — stamped by
  // the guard's verify, staff-correctable while the day is open, admin-locked
  // after End Shift. The verify timestamp is only the fallback, so the app's
  // "hours so far" and the Pay Engine's day-end hours can never diverge.
  const checkoutForClock = handovers.find((h) => h.kind === "checkout" && h.status === "verified");
  const shiftStartMs = (() => {
    if (!checkoutForClock) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(att?.riderTimeIn ?? "");
    if (m) {
      const t = new Date(`${date}T${m[1]!.padStart(2, "0")}:${m[2]}:00+05:45`).getTime();
      if (Number.isFinite(t)) return t;
    }
    return new Date((checkoutForClock.verifiedAt ?? checkoutForClock.submittedAt) as unknown as string).getTime();
  })();

  const checkout = handovers.find((h) => h.kind === "checkout");
  const checkoutPayload = (checkout?.payload ?? {}) as Record<string, unknown>;

  let vehicle: { id: number; plate: string | null; model: string | null } | null = null;
  if (checkout?.vehicleId) {
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, checkout.vehicleId));
    if (v) vehicle = { id: v.id, plate: v.plateNumber, model: v.model };
  }

  const bonus = (num(log?.goalBonus) ?? 0) + (num(log?.promotionBonusOther) ?? 0);
  const target = await dayTargetFor(rider.id, date);
  res.json({
    fleetEnabled: enabled,
    date,
    shiftState: shiftStateOf(handovers),
    // The rider app's shift clock — attendance-derived (see shiftStartMs above).
    shiftStartedAt: shiftStartMs ? new Date(shiftStartMs).toISOString() : null,
    assignedVehicle: assignment?.vehicleId
      ? { id: assignment.vehicleId, plate: assignment.plate, model: assignment.model }
      : null,
    vehicle,
    goalTier: (checkoutPayload["goalTier"] as number | undefined) ?? null,
    // Tier picker data (additive): default = the rider's current ramp gate;
    // options = ramp gates + one stretch tier. Club app should render these
    // instead of hardcoding.
    ...(await goalTiersFor(rider.id, date)),
    handover: (() => {
      const open = [...handovers].reverse().find((h) => h.status === "pending");
      return open ? { id: open.id, kind: open.kind, status: open.status } : null;
    })(),
    yangoDay: log
      ? {
          rides: log.ridesCompleted ?? 0,
          appCash: num(log.cashAsPerApp) ?? 0,
          bonus,
          provisional: true,
          asOf: log.yangoSyncedAt ?? log.createdAt,
        }
      : null,
    ...(await (async () => {
      // Live, provisional estimates from today's (possibly draft) Yango data.
      // The official number is only ever a locked pay_record.
      const proj = await computeDay(rider.id, date, { provisional: true });
      const pickedGoal = (checkoutPayload["goalTier"] as number | undefined) ?? null;

      // Tentative Yango goal-bonus for the picked tier (the picker mirrors
      // Yango's goal list, so the pick IS the Yango goal). Estimate only.
      let bonusEstimate: ReturnType<typeof bonusEstimateFor> = null;
      if (pickedGoal != null && log) {
        bonusEstimate = bonusEstimateFor(pickedGoal, num(log.cashAsPerApp) ?? 0, await getPayParams(date));
      }

      if (!proj.ok) return { payProjection: null, bonusEstimate, estimatedPayWithBonus: null };
      const { base, commission, prize, growth, total } = proj.day;

      // Same formula with the tentative bonus folded into revenue — what the
      // day looks like once Yango confirms the goal bonus tomorrow.
      let estimatedPayWithBonus = null;
      if (bonusEstimate && bonusEstimate.estimatedNow > 0) {
        const p = proj.day.params;
        const rev2 = proj.day.inputs.revenue + bonusEstimate.estimatedNow;
        const commission2 = Math.round(p.commissionRate * Math.min(rev2, p.revenueCap) * 100) / 100;
        const growth2 = Math.round(p.growthRate * Math.max(rev2 - p.revenueCap, 0) * 100) / 100;
        estimatedPayWithBonus = {
          base,
          commission: commission2,
          prize,
          growth: growth2,
          bonusInRevenue: bonusEstimate.estimatedNow,
          total: Math.round((base + commission2 + prize + growth2) * 100) / 100,
          provisional: true,
        };
      }
      return {
        payProjection: { base, commission, prize, growth, total, provisional: true },
        bonusEstimate,
        estimatedPayWithBonus,
      };
    })()),
    streak: { current: streak?.currentStreak ?? 0, best: streak?.bestStreak ?? 0 },
    monthToDate: {
      earned: lockedRecords.reduce((s, r) => s + (num(r.dailyPay) ?? 0), 0),
      daysLocked: lockedRecords.length,
    },
    // Pay-Model-v2 breakdown data (additive): what the full day is WORTH
    // (config + ramp driven — the app must never hardcode money values)…
    payTarget: target,
    // …and how far the rider is from each gate right now. Fields are null
    // when the underlying data isn't known yet (never fake zeros).
    gaps: (() => {
      const hoursSoFar = shiftStartMs ? Math.max(0, Math.round(((Date.now() - shiftStartMs) / 36e5) * 10) / 10) : null;
      const rides = log ? (log.ridesCompleted ?? 0) : null;
      const cash = log ? (num(log.cashAsPerApp) ?? 0) : null;
      return {
        ridesToGate: rides != null ? Math.max(0, target.gateRides - rides) : null,
        cashToGate: cash != null ? Math.max(0, Math.round((target.gateCash - cash) * 100) / 100) : null,
        ridesToBase: rides != null ? Math.max(0, target.baseMinRides - rides) : null,
        hoursSoFar,
        hoursToBase: hoursSoFar != null ? Math.max(0, Math.round((target.baseMinHours - hoursSoFar) * 10) / 10) : null,
      };
    })(),
  });
});

// ─── POST /fleet/v1/photos ───────────────────────────────────────────────────

router.post(
  "/fleet/v1/photos",
  riderScoped,
  express.raw({ type: () => true, limit: "10mb" }),
  async (req, res): Promise<void> => {
    const name = typeof req.query.name === "string" ? req.query.name : "photo.jpg";
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Request body must be the raw image bytes" });
      return;
    }
    const { objectPath } = await objectStorage.upload({
      body: req.body,
      contentType: req.headers["content-type"] ?? "application/octet-stream",
      originalName: name,
      visibility: "private",
    });
    res.status(201).json({ objectPath });
  },
);

// ─── POST /fleet/v1/checkout ─────────────────────────────────────────────────

router.post("/fleet/v1/checkout", riderScoped, async (req, res): Promise<void> => {
  const rider = (req as FleetRequest).fleetRider!;
  const key = requiredIdempotencyKey(req);
  if (!key) {
    res.status(400).json({ error: "X-Idempotency-Key header required" });
    return;
  }
  const existingByKey = await findByIdempotencyKey(key);
  if (existingByKey) {
    res.json({ handoverId: existingByKey.id, status: existingByKey.status === "pending" ? "pending_verify" : existingByKey.status });
    return;
  }

  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.message });
    return;
  }
  const date = parsed.data.date ?? getTodayNepal();

  const vehicle = await resolveVehicle(parsed.data.vehicleId, parsed.data.vehicleQr);
  if (!vehicle) {
    res.status(422).json({ error: "Vehicle not found — scan the scooter QR again or pick the assigned scooter." });
    return;
  }

  const handovers = await todaysHandovers(rider.id, date);
  if (handovers.some((h) => h.kind === "checkout")) {
    res.status(409).json({ error: "A checkout already exists for today." });
    return;
  }

  const [row] = await db
    .insert(fleetHandoversTable)
    .values({
      riderId: rider.id,
      englishDate: date,
      kind: "checkout",
      idempotencyKey: key,
      vehicleId: vehicle.id,
      payload: {
        odometerOut: parsed.data.odometerOut,
        batteryOutPct: parsed.data.batteryOutPct,
        goalTier: parsed.data.goalTier,
        photoPaths: parsed.data.photoPaths ?? {},
      },
    })
    .returning();

  logActivity(null, `Rider app (${rider.fullName})`, "created", "fleet",
    `Check-out submitted for ${date} on vehicle #${vehicle.id} — pending guard verification`);
  res.status(201).json({ handoverId: row.id, status: "pending_verify" });
});

// ─── POST /fleet/v1/exchange ─────────────────────────────────────────────────

router.post("/fleet/v1/exchange", riderScoped, async (req, res): Promise<void> => {
  const rider = (req as FleetRequest).fleetRider!;
  const key = requiredIdempotencyKey(req);
  if (!key) {
    res.status(400).json({ error: "X-Idempotency-Key header required" });
    return;
  }
  const existingByKey = await findByIdempotencyKey(key);
  if (existingByKey) {
    res.json({ handoverId: existingByKey.id, status: "pending_verify" });
    return;
  }

  const parsed = ExchangeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.message });
    return;
  }
  const date = parsed.data.date ?? getTodayNepal();

  const handovers = await todaysHandovers(rider.id, date);
  if (shiftStateOf(handovers) !== "active") {
    res.status(409).json({ error: "Exchange is only possible during an active shift (after guard confirms your check-out)." });
    return;
  }

  const newVehicle = await resolveVehicle(parsed.data.opening.vehicleId, parsed.data.opening.vehicleQr);
  if (!newVehicle) {
    res.status(422).json({ error: "Replacement vehicle not found — scan its QR again." });
    return;
  }

  const [row] = await db
    .insert(fleetHandoversTable)
    .values({
      riderId: rider.id,
      englishDate: date,
      kind: "exchange",
      idempotencyKey: key,
      vehicleId: newVehicle.id,
      payload: {
        closing: parsed.data.closing,
        reason: parsed.data.reason,
        reasonNote: parsed.data.reasonNote ?? null,
        opening: { ...parsed.data.opening, vehicleId: newVehicle.id },
      },
    })
    .returning();

  logActivity(null, `Rider app (${rider.fullName})`, "created", "fleet",
    `Scooter exchange submitted for ${date} (reason: ${parsed.data.reason}) — pending guard verification`);
  res.status(201).json({ handoverId: row.id, status: "pending_verify" });
});

// ─── POST /fleet/v1/checkin ──────────────────────────────────────────────────

router.post("/fleet/v1/checkin", riderScoped, async (req, res): Promise<void> => {
  const rider = (req as FleetRequest).fleetRider!;
  const key = requiredIdempotencyKey(req);
  if (!key) {
    res.status(400).json({ error: "X-Idempotency-Key header required" });
    return;
  }
  const existingByKey = await findByIdempotencyKey(key);
  if (existingByKey) {
    res.json({
      handoverId: existingByKey.id,
      status: "pending_verify",
      cashExpected: num(existingByKey.cashExpected),
      variance: num(existingByKey.cashVariance),
      provisional: true,
    });
    return;
  }

  const parsed = CheckinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.message });
    return;
  }
  const date = parsed.data.date ?? getTodayNepal();

  const handovers = await todaysHandovers(rider.id, date);
  const checkout = handovers.find((h) => h.kind === "checkout");
  if (!checkout) {
    res.status(409).json({ error: "No shift was started today — check out first." });
    return;
  }
  if (handovers.some((h) => h.kind === "checkin")) {
    res.status(409).json({ error: "A check-in already exists for today." });
    return;
  }

  // Provisional expected-handover figure from today's synced Yango data (if
  // any): expected = app cash − daily allowance the rider keeps. The OFFICIAL
  // variance remains finance's next-day comparison — this is a heads-up only.
  let cashExpected: number | null = null;
  let variance: number | null = null;
  {
    const [log] = await db
      .select({ appCash: dailyLogsTable.cashAsPerApp, allowance: dailyLogsTable.dailyAllowance })
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.riderId, rider.id), eq(dailyLogsTable.englishDate, date)));
    const appCash = num(log?.appCash);
    if (appCash != null && appCash > 0) {
      cashExpected = Math.max(0, appCash - (num(log?.allowance) ?? 0));
      variance = Math.round((parsed.data.cashDeclared + parsed.data.walletDeclared - cashExpected) * 100) / 100;
    }
  }

  const [row] = await db
    .insert(fleetHandoversTable)
    .values({
      riderId: rider.id,
      englishDate: date,
      kind: "checkin",
      idempotencyKey: key,
      vehicleId: checkout.vehicleId,
      cashExpected: cashExpected != null ? cashExpected.toFixed(2) : null,
      cashVariance: variance != null ? variance.toFixed(2) : null,
      payload: {
        odometerIn: parsed.data.odometerIn,
        batteryInPct: parsed.data.batteryInPct,
        cashDeclared: parsed.data.cashDeclared,
        walletDeclared: parsed.data.walletDeclared,
        photoPaths: parsed.data.photoPaths ?? {},
      },
    })
    .returning();

  logActivity(null, `Rider app (${rider.fullName})`, "created", "fleet",
    `Check-in submitted for ${date} — cash declared रू ${parsed.data.cashDeclared} — pending guard verification`);
  res.status(201).json({ handoverId: row.id, status: "pending_verify", cashExpected, variance, provisional: true });
});

// ─── GET /fleet/v1/handovers/:id ─────────────────────────────────────────────

router.get("/fleet/v1/handovers/:id", riderScoped, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid handover id" });
    return;
  }
  const [row] = await db.select().from(fleetHandoversTable).where(eq(fleetHandoversTable.id, id));
  if (!row || row.riderId !== (req as FleetRequest).fleetRider!.id) {
    res.status(404).json({ error: "Handover not found" });
    return;
  }
  res.json({ id: row.id, kind: row.kind, status: row.status, rejectReason: row.rejectReason ?? undefined });
});

// ─── GET /fleet/v1/pay/month/:month and /pay/day/:date ──────────────────────

// The rule numbers behind each pay line, read from the record's OWN stored
// config snapshot — a day recalibrated after the fact still shows the gates
// it was actually priced under. Percentages are whole numbers (20, not 0.2).
// null when a legacy record has no snapshot; the app falls back to plain labels.
function payRulesFrom(gatesApplied: unknown): Record<string, unknown> | null {
  const ga = (gatesApplied ?? {}) as {
    gates?: { gateRides?: number; gateCash?: number; prize?: number };
    params?: { baseAmount?: number; baseMinHours?: number; baseMinRides?: number; commissionRate?: number; revenueCap?: number; growthRate?: number };
  };
  if (!ga.gates || !ga.params) return null;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    base: { amount: n(ga.params.baseAmount), minRides: n(ga.params.baseMinRides), minHours: n(ga.params.baseMinHours) },
    commission: { pct: Math.round(n(ga.params.commissionRate) * 100), revenueCap: n(ga.params.revenueCap) },
    prize: { amount: n(ga.gates.prize), gateRides: n(ga.gates.gateRides), gateCash: n(ga.gates.gateCash) },
    growth: { pct: Math.round(n(ga.params.growthRate) * 100), aboveRevenue: n(ga.params.revenueCap) },
  };
}

router.get("/fleet/v1/pay/month/:month", riderScoped, async (req, res): Promise<void> => {
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Month must be YYYY-MM" });
    return;
  }
  const rider = (req as FleetRequest).fleetRider!;
  const [records, advances] = await Promise.all([
    db
      .select()
      .from(payRecordsTable)
      .where(
        and(
          eq(payRecordsTable.riderId, rider.id),
          eq(payRecordsTable.status, "locked"),
          like(payRecordsTable.englishDate, `${month}%`),
        ),
      )
      .orderBy(payRecordsTable.englishDate),
    db
      .select()
      .from(salaryAdvancesTable)
      .where(
        and(
          eq(salaryAdvancesTable.riderId, rider.id),
          gte(salaryAdvancesTable.date, `${month}-01`),
          lte(salaryAdvancesTable.date, `${month}-31`),
        ),
      ),
  ]);

  const days = records.map((r) => {
    // rides/revenue are part of the §5.8 contract — read from the inputs
    // snapshot every record stores at lock time.
    const inputs = ((r.gatesApplied as { inputs?: Record<string, unknown> } | null)?.inputs ?? {}) as Record<string, unknown>;
    return {
      date: r.englishDate,
      rides: Number(inputs["rides"] ?? 0) || 0,
      revenue: Math.round((Number(inputs["revenue"] ?? 0) || 0) * 100) / 100,
      base: num(r.base) ?? 0,
      commission: num(r.commission) ?? 0,
      prize: num(r.prize) ?? 0,
      growth: num(r.growth) ?? 0,
      total: num(r.dailyPay) ?? 0,
      locked: true,
      rules: payRulesFrom(r.gatesApplied),
    };
  });
  res.json({
    days,
    // Informational: streak awards are already INCLUDED in each day's total.
    streakBonuses: records.reduce((s, r) => s + (Number((r.flags as Record<string, unknown> | null)?.["streakBonus"] ?? 0) || 0), 0),
    advances: advances.reduce((s, a) => s + (num(a.amount) ?? 0), 0),
    monthTotal: days.reduce((s, d) => s + d.total, 0),
  });
});

router.get("/fleet/v1/pay/day/:date", riderScoped, async (req, res): Promise<void> => {
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Date must be YYYY-MM-DD" });
    return;
  }
  const [r] = await db
    .select()
    .from(payRecordsTable)
    .where(and(eq(payRecordsTable.riderId, (req as FleetRequest).fleetRider!.id), eq(payRecordsTable.englishDate, date)));
  if (!r || r.status !== "locked") {
    res.status(404).json({ error: "No locked pay record for this date" });
    return;
  }
  const dayInputs = ((r.gatesApplied as { inputs?: Record<string, unknown> } | null)?.inputs ?? {}) as Record<string, unknown>;
  res.json({
    date: r.englishDate,
    rides: Number(dayInputs["rides"] ?? 0) || 0,
    revenue: Math.round((Number(dayInputs["revenue"] ?? 0) || 0) * 100) / 100,
    base: num(r.base) ?? 0,
    commission: num(r.commission) ?? 0,
    prize: num(r.prize) ?? 0,
    growth: num(r.growth) ?? 0,
    total: num(r.dailyPay) ?? 0,
    rules: payRulesFrom(r.gatesApplied),
    gatesApplied: r.gatesApplied ?? null,
    flags: r.flags ?? null,
    locked: true,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Guard console (session-authed, EFMS web). Reuses the EXISTING permission
// sections — verifying a handover IS attendance editing, and the evening cash
// step IS cash-collection creation — so no new permission section, no
// isAdmin/registry sprawl, and whoever can do the manual flow today can verify.
// ═════════════════════════════════════════════════════════════════════════════

/** "HH:MM" in Nepal local time, matching the guard-typed time format. */
function nepalHHMM(d: Date): string {
  const nepal = new Date(d.getTime() + (5 * 60 + 45) * 60 * 1000);
  return nepal.toISOString().slice(11, 16);
}

// ─── GET /fleet/handovers/pending ───────────────────────────────────────────

router.get("/fleet/handovers/pending", requirePermission("attendance", "canEdit"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: fleetHandoversTable.id,
      riderId: fleetHandoversTable.riderId,
      riderName: ridersTable.fullName,
      englishDate: fleetHandoversTable.englishDate,
      kind: fleetHandoversTable.kind,
      payload: fleetHandoversTable.payload,
      vehicleId: fleetHandoversTable.vehicleId,
      vehiclePlate: vehiclesTable.plateNumber,
      submittedAt: fleetHandoversTable.submittedAt,
    })
    .from(fleetHandoversTable)
    .leftJoin(ridersTable, eq(fleetHandoversTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(fleetHandoversTable.vehicleId, vehiclesTable.id))
    .where(eq(fleetHandoversTable.status, "pending"))
    .orderBy(fleetHandoversTable.submittedAt);
  res.json(rows);
});

// ─── POST /fleet/handovers/:id/verify ───────────────────────────────────────

const VerifyBody = z.object({
  // Guard corrections — the guard's numbers are authoritative over the rider's.
  corrections: z
    .object({
      odometer: z.number().int().positive().optional(),
      batteryPct: z.number().int().min(0).max(100).optional(),
      cashDeclared: z.number().min(0).optional(),
      walletDeclared: z.number().min(0).optional(),
    })
    .optional(),
});

router.post("/fleet/handovers/:id/verify", requirePermission("attendance", "canEdit"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid handover id" }); return; }
  const parsed = VerifyBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(422).json({ error: parsed.error.message }); return; }

  const [h] = await db.select().from(fleetHandoversTable).where(eq(fleetHandoversTable.id, id));
  if (!h) { res.status(404).json({ error: "Handover not found" }); return; }
  if (h.status !== "pending") {
    res.status(409).json({ error: `Handover is already ${h.status}.` });
    return;
  }

  const payload = { ...(h.payload as Record<string, unknown>) };
  const corr = parsed.data.corrections;
  if (corr && Object.keys(corr).length > 0) {
    const original: Record<string, unknown> = {};
    if (corr.odometer != null) {
      const key = h.kind === "checkin" ? "odometerIn" : "odometerOut";
      original[key] = payload[key];
      payload[key] = corr.odometer;
    }
    if (corr.batteryPct != null) {
      const key = h.kind === "checkin" ? "batteryInPct" : "batteryOutPct";
      original[key] = payload[key];
      payload[key] = corr.batteryPct;
    }
    if (corr.cashDeclared != null) { original["cashDeclared"] = payload["cashDeclared"]; payload["cashDeclared"] = corr.cashDeclared; }
    if (corr.walletDeclared != null) { original["walletDeclared"] = payload["walletDeclared"]; payload["walletDeclared"] = corr.walletDeclared; }
    payload["corrections"] = { by: req.session.userName ?? "Unknown", original };
  }

  const guardId = req.session.userId ?? null;
  const guardName = req.session.userName ?? "Unknown";
  const timeHHMM = nepalHHMM(new Date());

  // Project into the canonical attendance row — same fields/formats the guard
  // types manually, upserted on the (rider_id, date) unique index from Phase 0.
  const [existing] = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.riderId, h.riderId), eq(attendanceTable.date, h.englishDate)));

  if (h.kind === "checkout") {
    const fields = {
      type: "present",
      vehicleId: h.vehicleId,
      batteryOut: payload["batteryOutPct"] as number,
      distanceIn: String(payload["odometerOut"]), // distance_in = MORNING odometer (schema naming is inverted)
      riderTimeIn: timeHHMM,
      scooterOut: timeHHMM,
    };
    if (existing) {
      await db.update(attendanceTable).set(fields).where(eq(attendanceTable.id, existing.id));
    } else {
      await db.insert(attendanceTable).values({ riderId: h.riderId, date: h.englishDate, ...fields });
    }
  } else if (h.kind === "exchange") {
    const opening = payload["opening"] as Record<string, unknown>;
    const reason = String(payload["reason"] ?? "exchange");
    if (existing) {
      await db
        .update(attendanceTable)
        .set({
          vehicleId: h.vehicleId, // day's primary vehicle = the latest one (evening readings belong to it)
          vehicleOverrideReason: `Mid-day exchange (${reason}) — battery ${(payload["closing"] as Record<string, unknown>)?.["batteryPct"]}% at handback`,
          batteryOut: (opening?.["batteryPct"] as number) ?? undefined,
          distanceIn: opening?.["odometer"] != null ? String(opening["odometer"]) : undefined,
        })
        .where(eq(attendanceTable.id, existing.id));
    } else {
      res.status(409).json({ error: "No attendance row exists for this rider-day — verify the check-out first." });
      return;
    }
  } else if (h.kind === "checkin") {
    if (!existing) {
      res.status(409).json({ error: "No attendance row exists for this rider-day — verify the check-out first." });
      return;
    }
    // Cash collection first: if it conflicts, the handover stays pending and
    // nothing is half-applied.
    const cash = Number(payload["cashDeclared"] ?? 0);
    const wallet = Number(payload["walletDeclared"] ?? 0);
    try {
      await db.insert(cashCollectionsTable).values({
        riderId: h.riderId,
        englishDate: h.englishDate,
        cashTotal: cash.toFixed(2),
        walletAmount: wallet.toFixed(2),
        grandTotal: (cash + wallet).toFixed(2),
        note: "Submitted via rider app",
        submittedBy: guardId,
        submittedByName: guardName,
        approvalStatus: "pending",
      });
    } catch (err) {
      if (isUniqueViolationFleet(err)) {
        res.status(409).json({ error: "A cash collection already exists for this rider today — resolve it on the Cash Collection page, then verify again." });
        return;
      }
      throw err;
    }
    await db
      .update(attendanceTable)
      .set({
        batteryIn: payload["batteryInPct"] as number,
        distanceOut: String(payload["odometerIn"]), // distance_out = EVENING odometer
        riderTimeOut: timeHHMM,
        scooterIn: timeHHMM,
      })
      .where(eq(attendanceTable.id, existing.id));
  }

  const [updated] = await db
    .update(fleetHandoversTable)
    .set({ status: "verified", payload, verifiedBy: guardId, verifiedByName: guardName, verifiedAt: new Date() })
    .where(and(eq(fleetHandoversTable.id, id), eq(fleetHandoversTable.status, "pending")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Handover was verified by someone else just now." });
    return;
  }

  logActivity(guardId, guardName, "updated", "attendance",
    `Verified rider-app ${h.kind} for rider #${h.riderId} on ${h.englishDate}`);
  res.json({ id: updated.id, status: updated.status });
});

// ─── POST /fleet/handovers/:id/reject ───────────────────────────────────────

router.post("/fleet/handovers/:id/reject", requirePermission("attendance", "canEdit"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid handover id" }); return; }
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;
  if (!reason) { res.status(400).json({ error: "A reject reason is required" }); return; }

  const [updated] = await db
    .update(fleetHandoversTable)
    .set({
      status: "rejected",
      rejectReason: reason,
      verifiedBy: req.session.userId ?? null,
      verifiedByName: req.session.userName ?? "Unknown",
      verifiedAt: new Date(),
    })
    .where(and(eq(fleetHandoversTable.id, id), eq(fleetHandoversTable.status, "pending")))
    .returning();
  if (!updated) { res.status(409).json({ error: "Handover is not pending (already verified or rejected)." }); return; }

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "attendance",
    `Rejected rider-app ${updated.kind} for rider #${updated.riderId} on ${updated.englishDate} — ${reason}`);
  res.json({ id: updated.id, status: updated.status });
});

function isUniqueViolationFleet(err: unknown): boolean {
  let e = err as { code?: string; cause?: unknown } | null;
  for (let depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    if (e.code === "23505") return true;
    e = e.cause as typeof e;
  }
  return false;
}

export default router;
