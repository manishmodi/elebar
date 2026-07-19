import { and, eq, lt, lte, desc, count } from "drizzle-orm";
import {
  db,
  dailyLogsTable,
  attendanceTable,
  ridersTable,
  payConfigTable,
  payRecordsTable,
  streaksTable,
} from "@workspace/db";
import { logActivity } from "./activity-logger";

/**
 * Variable Pay Engine (Pay Model v2).
 *
 * daily_pay = base + commission + prize + growth (+ streak bonus on the day a
 * streak completes). "Revenue" = customer app-cash + Yango bonuses (goal +
 * promo). Every parameter lives in pay_config, versioned by effective_from —
 * a day is ALWAYS computed under the config that was active on that date, so
 * historical recomputes are stable across recalibrations.
 *
 * A pay_record is computed and LOCKED when finance approves the day's cash
 * collection (the existing next-day approval flow) — never on drafts. Later
 * edits to the day's log recompute the record with an audit entry; the streak
 * counter is deliberately NOT rewound on recompute (flagged instead) so one
 * edited day can't silently cascade through a month of streaks.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RampTier {
  fromDay: number;
  toDay: number | null; // null = open-ended
  gateRides: number;
  gateCash: number;
  prize: number;
}

/** One row of Yango's own goal-bonus ladder: bonus = pct × cash, capped at max, paid when trips hit. */
export interface YangoBonusTier {
  trips: number;
  pct: number;
  max: number;
}

export interface PayParams {
  baseAmount: number;
  baseMinHours: number;
  baseMinRides: number;
  commissionRate: number;
  revenueCap: number;
  growthRate: number;
  ramp: RampTier[];
  streakLength: number;
  streakBonus: number;
  monthlyFloor: number;
  yangoBonusTable: YangoBonusTier[];
}

export const DEFAULT_PARAMS: PayParams = {
  baseAmount: 600,
  baseMinHours: 8,
  baseMinRides: 22,
  commissionRate: 0.2,
  revenueCap: 3125,
  growthRate: 0.4,
  ramp: [
    { fromDay: 1, toDay: 3, gateRides: 17, gateCash: 1500, prize: 200 },
    { fromDay: 4, toDay: 7, gateRides: 22, gateCash: 2000, prize: 250 },
    { fromDay: 8, toDay: null, gateRides: 28, gateCash: 2500, prize: 300 },
  ],
  streakLength: 7,
  streakBonus: 500,
  monthlyFloor: 17500,
  // Yango's goal-bonus ladder (as shown in the Yango driver app). Config-
  // driven so Yango recalibrations are a Pay Settings edit, not a deploy.
  yangoBonusTable: [
    { trips: 3, pct: 0.1, max: 50 },
    { trips: 7, pct: 0.18, max: 190 },
    { trips: 13, pct: 0.19, max: 335 },
    { trips: 19, pct: 0.2, max: 520 },
    { trips: 24, pct: 0.22, max: 695 },
    { trips: 28, pct: 0.25, max: 895 },
    { trips: 32, pct: 0.28, max: 1020 },
    { trips: 35, pct: 0.31, max: 1290 },
    { trips: 37, pct: 0.35, max: 1490 },
  ],
};

/** Resolve the config active on `date` (latest effective_from <= date per parameter). */
export async function getPayParams(date: string): Promise<PayParams> {
  const rows = await db
    .select()
    .from(payConfigTable)
    .where(lte(payConfigTable.effectiveFrom, date))
    .orderBy(desc(payConfigTable.effectiveFrom));

  const first = new Map<string, string>();
  for (const r of rows) if (!first.has(r.parameter)) first.set(r.parameter, r.value);

  const num = (key: string, dflt: number) => {
    const v = parseFloat(first.get(key) ?? "");
    return Number.isFinite(v) ? v : dflt;
  };
  let ramp = DEFAULT_PARAMS.ramp;
  const rampRaw = first.get("ramp");
  if (rampRaw) {
    try {
      const parsed = JSON.parse(rampRaw);
      if (Array.isArray(parsed) && parsed.length > 0) ramp = parsed;
    } catch {
      /* keep default */
    }
  }
  let yangoBonusTable = DEFAULT_PARAMS.yangoBonusTable;
  const bonusRaw = first.get("yango_bonus_table");
  if (bonusRaw) {
    try {
      const parsed = JSON.parse(bonusRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        yangoBonusTable = [...parsed].sort((a: YangoBonusTier, b: YangoBonusTier) => a.trips - b.trips);
      }
    } catch {
      /* keep default */
    }
  }
  return {
    baseAmount: num("base_amount", DEFAULT_PARAMS.baseAmount),
    baseMinHours: num("base_min_hours", DEFAULT_PARAMS.baseMinHours),
    baseMinRides: num("base_min_rides", DEFAULT_PARAMS.baseMinRides),
    commissionRate: num("commission_rate", DEFAULT_PARAMS.commissionRate),
    revenueCap: num("revenue_cap", DEFAULT_PARAMS.revenueCap),
    growthRate: num("growth_rate", DEFAULT_PARAMS.growthRate),
    ramp,
    streakLength: num("streak_length", DEFAULT_PARAMS.streakLength),
    streakBonus: num("streak_bonus", DEFAULT_PARAMS.streakBonus),
    monthlyFloor: num("monthly_floor", DEFAULT_PARAMS.monthlyFloor),
    yangoBonusTable,
  };
}

/**
 * Tentative Yango bonus for the tier the rider picked (the picker mirrors
 * Yango's own goal list, so the pick IS their Yango goal). Estimate only —
 * locked pay always uses Yango's final next-day figure. Falls back to the
 * nearest tier at-or-below a non-listed pick.
 */
export function bonusEstimateFor(
  goalTier: number,
  appCash: number,
  params: PayParams,
): { tier: number; pct: number; max: number; estimatedNow: number } | null {
  const table = params.yangoBonusTable;
  if (!table.length) return null;
  let row = table.find((t) => t.trips === goalTier) ?? null;
  if (!row) {
    for (const t of table) if (t.trips <= goalTier) row = t;
  }
  if (!row) row = table[0]!;
  return {
    tier: row.trips,
    pct: row.pct,
    max: row.max,
    estimatedNow: r2(Math.min(row.pct * Math.max(appCash, 0), row.max)),
  };
}

// ─── Day computation ─────────────────────────────────────────────────────────

const toNum = (s: string | null | undefined): number => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** "HH:MM" pair -> hours worked; null when either side is missing/unparseable. */
function hoursBetween(inTime: string | null, outTime: string | null): number | null {
  const parse = (t: string | null): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
    if (!m) return null;
    return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
  };
  const a = parse(inTime);
  const b = parse(outTime);
  if (a == null || b == null) return null;
  let mins = b - a;
  if (mins < 0) mins += 24 * 60; // overnight shift
  return Math.round((mins / 60) * 100) / 100;
}

function rampFor(tenureDay: number, params: PayParams): RampTier {
  for (const t of params.ramp) {
    if (tenureDay >= t.fromDay && (t.toDay == null || tenureDay <= t.toDay)) return t;
  }
  return params.ramp[params.ramp.length - 1]!;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DayComputation {
  date: string;
  base: number;
  commission: number;
  prize: number;
  growth: number;
  total: number; // excl. streak bonus
  gatesHit: boolean;
  inputs: {
    rides: number;
    appCash: number;
    bonus: number;
    revenue: number;
    hours: number | null;
    tenureDay: number;
  };
  gates: RampTier;
  params: PayParams;
}

export type ComputeResult = { ok: true; day: DayComputation } | { ok: false; reason: string };

/**
 * The day being worked is tenure day N = (active days strictly BEFORE date)+1.
 * Counting strictly-before makes the answer stable whether or not today's log
 * exists yet (the live sync creates it mid-shift).
 */
async function tenureDayOf(riderId: number, date: string): Promise<number> {
  const [{ value: daysBefore }] = await db
    .select({ value: count() })
    .from(dailyLogsTable)
    .where(and(eq(dailyLogsTable.riderId, riderId), lt(dailyLogsTable.englishDate, date)));
  return daysBefore + 1;
}

/**
 * Goal-tier picker data for the rider app. The picker MIRRORS Yango's own
 * goal list (the rider's pick IS their Yango goal), so options come from the
 * yango_bonus_table config. Default = the nearest Yango tier at-or-above the
 * rider's ramp gate (17→19, 22→24, 28→28) — aim-high, always a real tier.
 */
export async function goalTiersFor(riderId: number, date: string): Promise<{
  goalTierDefault: number;
  goalTierOptions: number[];
  goalTierTable: YangoBonusTier[];
}> {
  const params = await getPayParams(date);
  const gates = rampFor(await tenureDayOf(riderId, date), params);
  const table = params.yangoBonusTable;
  const options = table.map((t) => t.trips);
  const atOrAbove = options.find((t) => t >= gates.gateRides);
  return {
    goalTierDefault: atOrAbove ?? options[options.length - 1] ?? gates.gateRides,
    goalTierOptions: options,
    goalTierTable: table,
  };
}

/**
 * What the rider's day is WORTH at full target — every money value from the
 * versioned config + the rider's ramp tier, so the Club app renders the
 * Pay-Model-v2 breakdown without hardcoding a single rupee.
 */
export async function dayTargetFor(riderId: number, date: string): Promise<{
  gateRides: number;
  gateCash: number;
  base: number;
  baseMinHours: number;
  baseMinRides: number;
  commissionAtCap: number;
  commissionRate: number;
  revenueCap: number;
  prize: number;
  growthRate: number;
  totalAtTarget: number;
}> {
  const params = await getPayParams(date);
  const gates = rampFor(await tenureDayOf(riderId, date), params);
  const commissionAtCap = r2(params.commissionRate * params.revenueCap);
  return {
    gateRides: gates.gateRides,
    gateCash: gates.gateCash,
    base: params.baseAmount,
    baseMinHours: params.baseMinHours,
    baseMinRides: params.baseMinRides,
    commissionAtCap,
    commissionRate: params.commissionRate,
    revenueCap: params.revenueCap,
    prize: gates.prize,
    growthRate: params.growthRate,
    totalAtTarget: r2(params.baseAmount + commissionAtCap + gates.prize),
  };
}

/**
 * Compute (without persisting) the pay for a rider-day. `provisional` allows
 * draft logs — used for the live in-app projection only; locking never does.
 */
export async function computeDay(riderId: number, date: string, opts?: { provisional?: boolean }): Promise<ComputeResult> {
  const [log] = await db
    .select()
    .from(dailyLogsTable)
    .where(and(eq(dailyLogsTable.riderId, riderId), eq(dailyLogsTable.englishDate, date)));
  if (!log) return { ok: false, reason: "no_daily_log" };
  if (log.isDraft && !opts?.provisional) return { ok: false, reason: "draft_log" };

  const [att] = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.riderId, riderId), eq(attendanceTable.date, date)));

  const [{ value: tenureDay }] = await db
    .select({ value: count() })
    .from(dailyLogsTable)
    .where(and(eq(dailyLogsTable.riderId, riderId), lte(dailyLogsTable.englishDate, date)));

  const params = await getPayParams(date);
  const rides = log.ridesCompleted ?? 0;
  const appCash = toNum(log.cashAsPerApp);
  const bonus = toNum(log.goalBonus) + toNum(log.promotionBonusOther);
  const revenue = appCash + bonus;
  let hours = hoursBetween(att?.riderTimeIn ?? null, att?.riderTimeOut ?? null);
  if (hours == null && opts?.provisional && att?.riderTimeIn) {
    // Mid-shift live estimate: no out-time yet, so count hours-so-far from the
    // shift start (Nepal clock). Locked pay always requires both real stamps.
    const nepalNowHHMM = new Date(Date.now() + 345 * 60 * 1000).toISOString().slice(11, 16);
    hours = hoursBetween(att.riderTimeIn, nepalNowHHMM);
  }

  const gates = rampFor(tenureDay, params);
  const base = hours != null && hours >= params.baseMinHours && rides >= params.baseMinRides ? params.baseAmount : 0;
  const commission = r2(params.commissionRate * Math.min(revenue, params.revenueCap));
  const gatesHit = rides >= gates.gateRides && appCash >= gates.gateCash;
  const prize = gatesHit ? gates.prize : 0;
  const growth = r2(params.growthRate * Math.max(revenue - params.revenueCap, 0));

  return {
    ok: true,
    day: {
      date,
      base,
      commission,
      prize,
      growth,
      total: r2(base + commission + prize + growth),
      gatesHit,
      inputs: { rides, appCash, bonus, revenue, hours, tenureDay },
      gates,
      params,
    },
  };
}

// ─── Lock / recompute ────────────────────────────────────────────────────────

/**
 * Compute and persist the locked pay_record for a pilot rider's day. Fired
 * when finance approves the day's cash collection; re-fired (recompute, with
 * audit) when a locked day's log is edited. Non-pilot riders are a no-op.
 */
export async function computeAndLockPay(
  riderId: number,
  date: string,
  actor: { userId: number | null; userName: string },
): Promise<{ locked: boolean; reason?: string; dailyPay?: number }> {
  const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.id, riderId));
  if (!rider?.fleetPilot) return { locked: false, reason: "not_pilot" };

  const result = await computeDay(riderId, date);
  if (!result.ok) return { locked: false, reason: result.reason };
  const day = result.day;

  const [existing] = await db
    .select()
    .from(payRecordsTable)
    .where(and(eq(payRecordsTable.riderId, riderId), eq(payRecordsTable.englishDate, date)));

  // Streak advances only on FIRST lock of a day — recomputes keep the streak
  // outcome that was awarded originally (flagged), so an edited Tuesday can't
  // silently rewrite the whole week's chain.
  let streakCount = 0;
  let streakBonusAwarded = 0;
  if (!existing) {
    const [s] = await db.select().from(streaksTable).where(eq(streaksTable.riderId, riderId));
    if (day.gatesHit) {
      // Previous ACTIVE day = the rider's latest log date before this one.
      const [prevLog] = await db
        .select({ d: dailyLogsTable.englishDate })
        .from(dailyLogsTable)
        .where(and(eq(dailyLogsTable.riderId, riderId), lte(dailyLogsTable.englishDate, date)))
        .orderBy(desc(dailyLogsTable.englishDate))
        .offset(1)
        .limit(1);
      const chainContinues = s?.lastQualifyingDate != null && prevLog?.d === s.lastQualifyingDate;
      streakCount = chainContinues ? (s?.currentStreak ?? 0) + 1 : 1;
      if (streakCount >= day.params.streakLength) {
        streakBonusAwarded = day.params.streakBonus;
        streakCount = 0; // counter resets after the award
      }
      const best = Math.max(s?.bestStreak ?? 0, streakCount === 0 ? day.params.streakLength : streakCount);
      if (s) {
        await db
          .update(streaksTable)
          .set({ currentStreak: streakCount, bestStreak: best, lastQualifyingDate: date, updatedAt: new Date() })
          .where(eq(streaksTable.riderId, riderId));
      } else {
        await db.insert(streaksTable).values({ riderId, currentStreak: streakCount, bestStreak: best, lastQualifyingDate: date });
      }
    } else if (s && s.currentStreak !== 0) {
      await db.update(streaksTable).set({ currentStreak: 0, updatedAt: new Date() }).where(eq(streaksTable.riderId, riderId));
    }
  } else {
    const flags = (existing.flags ?? {}) as Record<string, unknown>;
    streakBonusAwarded = toNum(String(flags["streakBonus"] ?? 0));
    streakCount = Number(flags["streakCount"] ?? 0);
  }

  const dailyPay = r2(day.total + streakBonusAwarded);
  const record = {
    base: day.base.toFixed(2),
    commission: day.commission.toFixed(2),
    prize: day.prize.toFixed(2),
    growth: day.growth.toFixed(2),
    dailyPay: dailyPay.toFixed(2),
    gatesApplied: { gates: day.gates, params: day.params, inputs: day.inputs } as unknown,
    flags: {
      gatesHit: day.gatesHit,
      streakCount,
      streakBonus: streakBonusAwarded,
      ...(existing ? { recomputed: true, streakNotRecomputed: true } : {}),
    } as unknown,
    status: "locked",
    lockedAt: new Date(),
  };

  if (existing) {
    const oldPay = toNum(existing.dailyPay);
    await db.update(payRecordsTable).set(record).where(eq(payRecordsTable.id, existing.id));
    if (Math.abs(oldPay - dailyPay) > 0.001) {
      logActivity(actor.userId, actor.userName, "updated", "salary",
        `Pay recomputed for rider #${riderId} on ${date}: रू ${oldPay.toFixed(2)} → रू ${dailyPay.toFixed(2)}`);
    }
  } else {
    await db.insert(payRecordsTable).values({ riderId, englishDate: date, ...record });
    logActivity(actor.userId, actor.userName, "created", "salary",
      `Day locked for rider #${riderId} on ${date} — pay रू ${dailyPay.toFixed(2)}${streakBonusAwarded ? ` (incl. रू ${streakBonusAwarded} streak bonus)` : ""}`);
  }

  return { locked: true, dailyPay };
}
