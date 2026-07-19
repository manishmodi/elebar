import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db, dailyLogsTable, ridersTable, vehiclesTable } from "@workspace/db";
import { requirePermission, parseParamId } from "../middlewares/auth";

const router: IRouter = Router();

interface DailyLogRow {
  id: number;
  riderId: number;
  englishDate: string;
  totalRidesReceived: number | null;
  ridesCompleted: number | null;
  acceptanceRate: string | null;
  dailyBonusSet: number | null;
  bonusTargetCompletion: boolean | null;
  totalRideDistanceKm: string | null;
  totalAppOnline: string | null;
  totalIncome: string | null;
  goalBonus: string | null;
  promotionBonusOther: string | null;
  cashCheck: string | null;
  isDraft: boolean;
}

interface RiderRow {
  id: number;
  fullName: string;
  phoneNumber: string;
  status: string;
  dailyRideTarget: number | null;
}

type Tier = "A+" | "A" | "B" | "C" | "D" | "Inactive";

function classifyTier(avgRidesPerDay: number, presentDays: number): Tier {
  if (presentDays === 0) return "Inactive";
  if (avgRidesPerDay >= 25) return "A+";
  if (avgRidesPerDay >= 22) return "A";
  if (avgRidesPerDay >= 18) return "B";
  if (avgRidesPerDay >= 15) return "C";
  return "D";
}

function countWorkingDays(from: Date, to: Date): number {
  // Count calendar days excluding Saturdays (weekly off in Nepal).
  // Returns 0 if the range contains only Saturdays.
  let count = 0;
  const d = new Date(from);
  while (d <= to) {
    if (d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function parseDateRange(
  dateFrom: unknown,
  dateTo: unknown,
): { from: string; to: string } | { error: string } {
  if (typeof dateFrom !== "string" || typeof dateTo !== "string") {
    return { error: "dateFrom and dateTo query params required (YYYY-MM-DD)" };
  }
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    return { error: "Invalid date format. Use YYYY-MM-DD." };
  }
  // Verify these are real calendar dates (rejects 2026-13-40, 2026-02-30, etc.)
  const fromParts = dateFrom.split("-").map((x) => parseInt(x, 10));
  const toParts = dateTo.split("-").map((x) => parseInt(x, 10));
  const fromDate = new Date(Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]));
  const toDate = new Date(Date.UTC(toParts[0], toParts[1] - 1, toParts[2]));
  const isRealDate = (d: Date, parts: number[]) =>
    d.getUTCFullYear() === parts[0] &&
    d.getUTCMonth() === parts[1] - 1 &&
    d.getUTCDate() === parts[2];
  if (!isRealDate(fromDate, fromParts) || !isRealDate(toDate, toParts)) {
    return { error: "Invalid calendar date." };
  }
  if (dateFrom > dateTo) {
    return { error: "dateFrom must not be after dateTo." };
  }
  return { from: dateFrom, to: dateTo };
}

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function parseOnlineToHours(v: string | null | undefined): number {
  // Format may be "5:30" (H:MM) or a plain number of hours
  if (!v) return 0;
  if (v.includes(":")) {
    const [h, m] = v.split(":").map((x) => parseInt(x, 10));
    if (isNaN(h)) return 0;
    return h + (isNaN(m) ? 0 : m / 60);
  }
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

router.get("/performance", requirePermission("performance", "canView"), async (req, res): Promise<void> => {
  const range = parseDateRange(req.query.dateFrom, req.query.dateTo);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  const { from: dateFrom, to: dateTo } = range;

  // Fetch all riders (we want absent riders to appear in the table too)
  const riders: RiderRow[] = await db
    .select({
      id: ridersTable.id,
      fullName: ridersTable.fullName,
      phoneNumber: ridersTable.phoneNumber,
      status: ridersTable.status,
      dailyRideTarget: ridersTable.dailyRideTarget,
    })
    .from(ridersTable);

  // Fetch all daily logs in the period in a single query
  const logs: DailyLogRow[] = await db
    .select({
      id: dailyLogsTable.id,
      riderId: dailyLogsTable.riderId,
      englishDate: dailyLogsTable.englishDate,
      totalRidesReceived: dailyLogsTable.totalRidesReceived,
      ridesCompleted: dailyLogsTable.ridesCompleted,
      acceptanceRate: dailyLogsTable.acceptanceRate,
      dailyBonusSet: dailyLogsTable.dailyBonusSet,
      bonusTargetCompletion: dailyLogsTable.bonusTargetCompletion,
      totalRideDistanceKm: dailyLogsTable.totalRideDistanceKm,
      totalAppOnline: dailyLogsTable.totalAppOnline,
      totalIncome: dailyLogsTable.totalIncome,
      goalBonus: dailyLogsTable.goalBonus,
      promotionBonusOther: dailyLogsTable.promotionBonusOther,
      cashCheck: dailyLogsTable.cashCheck,
      isDraft: dailyLogsTable.isDraft,
    })
    .from(dailyLogsTable)
    .where(
      and(
        gte(dailyLogsTable.englishDate, dateFrom),
        lte(dailyLogsTable.englishDate, dateTo),
      ),
    )
    .orderBy(desc(dailyLogsTable.englishDate));

  // Index logs by rider
  const logsByRider = new Map<number, DailyLogRow[]>();
  for (const log of logs) {
    const arr = logsByRider.get(log.riderId) ?? [];
    arr.push(log);
    logsByRider.set(log.riderId, arr);
  }

  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T00:00:00");
  const workingDays = countWorkingDays(fromDate, toDate);

  type RiderPerformance = {
    riderId: number;
    riderName: string;
    phoneNumber: string;
    status: string;
    dailyRideTarget: number | null;
    presentDays: number;
    absentDays: number;
    workingDays: number;
    attendanceRate: number;
    totalRidesReceived: number;
    totalRidesCompleted: number;
    avgRidesPerDay: number;
    acceptanceRate: number;
    targetHitDays: number;
    targetMissedDays: number;
    targetHitRate: number;
    totalRevenue: number;
    avgRevenuePerDay: number;
    totalGoalBonus: number;
    totalPromoBonus: number;
    totalDistanceKm: number;
    totalOnlineHours: number;
    cashVarianceDays: number;
    fraudDays: number;
    evaluableDays: number;
    fraudDates: string[];
    tier: Tier;
    flags: string[];
  };

  const perRider: RiderPerformance[] = riders.map((rider) => {
    const ridLogs = (logsByRider.get(rider.id) ?? []).filter((l) => !l.isDraft);

    const presentLogs = ridLogs.filter(
      (l) => (l.ridesCompleted ?? 0) > 0 || (l.totalRidesReceived ?? 0) > 0,
    );
    const presentDays = presentLogs.length;
    const absentDays = Math.max(0, workingDays - presentDays);

    const totalRidesReceived = presentLogs.reduce((a, l) => a + (l.totalRidesReceived ?? 0), 0);
    const totalRidesCompleted = presentLogs.reduce((a, l) => a + (l.ridesCompleted ?? 0), 0);
    const avgRidesPerDay = presentDays > 0 ? totalRidesCompleted / presentDays : 0;
    const acceptanceRate = totalRidesReceived > 0 ? (totalRidesCompleted / totalRidesReceived) * 100 : 0;

    const targetHitDays = presentLogs.filter((l) => l.bonusTargetCompletion === true).length;
    const targetMissedDays = Math.max(0, presentDays - targetHitDays);
    const targetHitRate = presentDays > 0 ? (targetHitDays / presentDays) * 100 : 0;

    const totalRevenue = presentLogs.reduce((a, l) => a + num(l.totalIncome), 0);
    const avgRevenuePerDay = presentDays > 0 ? totalRevenue / presentDays : 0;
    const totalGoalBonus = presentLogs.reduce((a, l) => a + num(l.goalBonus), 0);
    const totalPromoBonus = presentLogs.reduce((a, l) => a + num(l.promotionBonusOther), 0);
    const totalDistanceKm = presentLogs.reduce((a, l) => a + num(l.totalRideDistanceKm), 0);
    const totalOnlineHours = presentLogs.reduce((a, l) => a + parseOnlineToHours(l.totalAppOnline), 0);
    const cashVarianceDays = presentLogs.filter((l) => Math.abs(num(l.cashCheck)) > 0.01).length;

    // Fraud detection — a day is "evaluable" only if Yango set a daily bonus target.
    // A fraud day = rider hit/exceeded target (rides completed >= target) BUT
    // Yango paid NO goal bonus (goalBonus is empty/null/0). The bonus amount is
    // the source of truth — if Yango disqualified rides for fraud, no money is paid
    // out, regardless of how the bonusTargetCompletion flag was recorded by staff.
    const evaluableLogs = presentLogs.filter(
      (l) => l.dailyBonusSet !== null && l.dailyBonusSet > 0,
    );
    const evaluableDays = evaluableLogs.length;
    const fraudLogs = evaluableLogs.filter(
      (l) =>
        (l.ridesCompleted ?? 0) >= (l.dailyBonusSet ?? 0) &&
        num(l.goalBonus) === 0,
    );
    const fraudDays = fraudLogs.length;
    const fraudDates = fraudLogs.map((l) => l.englishDate);

    const attendanceRate = workingDays > 0 ? (presentDays / workingDays) * 100 : 0;
    const tier = classifyTier(avgRidesPerDay, presentDays);

    const flags: string[] = [];
    if (presentDays > 0 && acceptanceRate < 70) flags.push("low_acceptance");
    if (workingDays > 0 && presentDays > 0 && attendanceRate < 90) flags.push("absentee");
    if (presentDays > 0 && targetHitRate < 60) flags.push("volatile");
    if (presentDays > 0 && targetHitRate >= 80) flags.push("bonus_hunter");
    if (cashVarianceDays > 0 && presentDays > 0 && cashVarianceDays / presentDays > 0.2) {
      flags.push("cash_discipline");
    }
    if (fraudDays > 0) flags.push("fraud_risk");

    return {
      riderId: rider.id,
      riderName: rider.fullName,
      phoneNumber: rider.phoneNumber,
      status: rider.status,
      dailyRideTarget: rider.dailyRideTarget,
      presentDays,
      absentDays,
      workingDays,
      attendanceRate: Number(attendanceRate.toFixed(1)),
      totalRidesReceived,
      totalRidesCompleted,
      avgRidesPerDay: Number(avgRidesPerDay.toFixed(1)),
      acceptanceRate: Number(acceptanceRate.toFixed(1)),
      targetHitDays,
      targetMissedDays,
      targetHitRate: Number(targetHitRate.toFixed(1)),
      totalRevenue: Number(totalRevenue.toFixed(2)),
      avgRevenuePerDay: Number(avgRevenuePerDay.toFixed(2)),
      totalGoalBonus: Number(totalGoalBonus.toFixed(2)),
      totalPromoBonus: Number(totalPromoBonus.toFixed(2)),
      totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
      totalOnlineHours: Number(totalOnlineHours.toFixed(1)),
      cashVarianceDays,
      fraudDays,
      evaluableDays,
      fraudDates,
      tier,
      flags,
    };
  });

  // High-earner flag: top 25% of active riders by avg revenue/day.
  // Cutoff is computed by rank, not value, so the count of flagged riders is exactly ceil(N*0.25).
  const activeRanked = perRider
    .filter((r) => r.presentDays > 0 && r.avgRevenuePerDay > 0)
    .sort((a, b) => b.avgRevenuePerDay - a.avgRevenuePerDay);
  const topCount = Math.ceil(activeRanked.length * 0.25);
  for (let i = 0; i < topCount; i++) {
    activeRanked[i].flags.push("high_earner");
  }

  // Sort by avg rides/day desc by default
  perRider.sort((a, b) => b.avgRidesPerDay - a.avgRidesPerDay);

  // Summary
  const activeRiders = perRider.filter((r) => r.presentDays > 0);
  const totalFleetRevenue = perRider.reduce((a, r) => a + r.totalRevenue, 0);
  const totalFleetRides = perRider.reduce((a, r) => a + r.totalRidesCompleted, 0);
  const totalFleetReceived = perRider.reduce((a, r) => a + r.totalRidesReceived, 0);

  const avgFleetRides = activeRiders.length > 0
    ? activeRiders.reduce((a, r) => a + r.avgRidesPerDay, 0) / activeRiders.length
    : 0;
  const fleetAcceptance = totalFleetReceived > 0
    ? (totalFleetRides / totalFleetReceived) * 100
    : 0;

  const tierDistribution: Record<Tier, number> = {
    "A+": 0, "A": 0, "B": 0, "C": 0, "D": 0, "Inactive": 0,
  };
  perRider.forEach((r) => { tierDistribution[r.tier]++; });

  res.json({
    period: { dateFrom, dateTo, workingDays },
    summary: {
      totalRiders: perRider.length,
      activeRiders: activeRiders.length,
      avgFleetRidesPerDay: Number(avgFleetRides.toFixed(1)),
      avgFleetAcceptance: Number(fleetAcceptance.toFixed(1)),
      totalRevenue: Number(totalFleetRevenue.toFixed(2)),
      totalRides: totalFleetRides,
    },
    tierDistribution,
    riders: perRider,
  });
});

router.get("/performance/rider/:riderId", requirePermission("performance", "canView"), async (req, res): Promise<void> => {
  const riderId = parseParamId(req.params.riderId);
  if (riderId === null) {
    res.status(400).json({ error: "Invalid rider ID" });
    return;
  }
  const range = parseDateRange(req.query.dateFrom, req.query.dateTo);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  const { from: dateFrom, to: dateTo } = range;

  const [rider] = await db
    .select({
      id: ridersTable.id,
      fullName: ridersTable.fullName,
      phoneNumber: ridersTable.phoneNumber,
      status: ridersTable.status,
      dailyRideTarget: ridersTable.dailyRideTarget,
    })
    .from(ridersTable)
    .where(eq(ridersTable.id, riderId));

  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }

  const logs = await db
    .select({
      id: dailyLogsTable.id,
      englishDate: dailyLogsTable.englishDate,
      nepaliDate: dailyLogsTable.nepaliDate,
      vehiclePlate: vehiclesTable.plateNumber,
      totalRidesReceived: dailyLogsTable.totalRidesReceived,
      ridesCompleted: dailyLogsTable.ridesCompleted,
      acceptanceRate: dailyLogsTable.acceptanceRate,
      dailyBonusSet: dailyLogsTable.dailyBonusSet,
      bonusTargetCompletion: dailyLogsTable.bonusTargetCompletion,
      totalRideDistanceKm: dailyLogsTable.totalRideDistanceKm,
      totalAppOnline: dailyLogsTable.totalAppOnline,
      totalIncome: dailyLogsTable.totalIncome,
      goalBonus: dailyLogsTable.goalBonus,
      promotionBonusOther: dailyLogsTable.promotionBonusOther,
      cashCheck: dailyLogsTable.cashCheck,
      isDraft: dailyLogsTable.isDraft,
    })
    .from(dailyLogsTable)
    .leftJoin(vehiclesTable, eq(dailyLogsTable.vehicleId, vehiclesTable.id))
    .where(
      and(
        eq(dailyLogsTable.riderId, riderId),
        gte(dailyLogsTable.englishDate, dateFrom),
        lte(dailyLogsTable.englishDate, dateTo),
      ),
    )
    .orderBy(desc(dailyLogsTable.englishDate));

  res.json({ rider, logs });
});

export default router;
