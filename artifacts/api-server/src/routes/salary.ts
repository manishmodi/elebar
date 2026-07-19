import { Router, type IRouter } from "express";
import { eq, and, gte, lte, inArray, isNull, desc } from "drizzle-orm";
import { db, ridersTable, dailyLogsTable, salaryAdvancesTable, salaryPaymentsTable, payConfigTable, payRecordsTable } from "@workspace/db";
import { z } from "zod/v4";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";
import { DEFAULT_PARAMS, getPayParams } from "../lib/pay-engine";

const router: IRouter = Router();

// Count non-Saturday days between two dates (inclusive)
function countWorkingDays(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  while (d <= to) {
    if (d.getDay() !== 6) count++; // 6 = Saturday
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

// Count non-Saturday days in a full calendar month (year, month = 0-indexed)
function workingDaysInCalendarMonth(year: number, month: number): number {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0); // last day of month
  return countWorkingDays(first, last);
}

// Compute the daily rate anchored to full calendar month(s).
// If the period spans two calendar months, average the two per-day rates.
function computeDailyRate(monthly: number, fromDate: Date, toDate: Date): number {
  const sy = fromDate.getFullYear(), sm = fromDate.getMonth();
  const ey = toDate.getFullYear(),   em = toDate.getMonth();
  if (sy === ey && sm === em) {
    // Single month — divide by that month's working days
    return monthly / workingDaysInCalendarMonth(sy, sm);
  }
  // Overlapping two months — average the two daily rates
  const startRate = monthly / workingDaysInCalendarMonth(sy, sm);
  const endRate   = monthly / workingDaysInCalendarMonth(ey, em);
  return (startRate + endRate) / 2;
}

// ─── Advances ──────────────────────────────────────────────────────────────

router.get("/salary/advances", requirePermission("salary", "canView"), async (req, res): Promise<void> => {
  const advances = await db.select().from(salaryAdvancesTable).orderBy(salaryAdvancesTable.date);
  const riders = await db.select({ id: ridersTable.id, fullName: ridersTable.fullName }).from(ridersTable);
  const riderMap = new Map(riders.map(r => [r.id, r.fullName]));
  res.json(advances.map(a => ({ ...a, riderName: riderMap.get(a.riderId) ?? "Unknown" })));
});

router.post("/salary/advances", requirePermission("salary", "canCreate"), async (req, res): Promise<void> => {
  const { riderId, date, amount, notes } = req.body;
  if (!riderId || !date || !amount) {
    res.status(400).json({ error: "riderId, date and amount are required" });
    return;
  }
  const [advance] = await db.insert(salaryAdvancesTable).values({
    riderId: parseInt(riderId, 10),
    date,
    amount: parseFloat(amount).toFixed(2),
    notes: notes || null,
  }).returning();
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "salary", `Recorded advance of रू ${amount} for rider ID ${riderId}`);
  res.status(201).json(advance);
});

router.delete("/salary/advances/:id", requirePermission("salary", "canDelete"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(salaryAdvancesTable).where(eq(salaryAdvancesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Advance not found" }); return; }
  if (existing.appliedAt) {
    res.status(409).json({ error: "Cannot delete an applied advance — it is already recorded in a processed salary run." });
    return;
  }

  await db.delete(salaryAdvancesTable).where(eq(salaryAdvancesTable.id, id));
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "salary", `Deleted advance ID ${id}`);
  res.sendStatus(204);
});

// ─── Calculate ─────────────────────────────────────────────────────────────

router.get("/salary/calculate", requirePermission("salary", "canView"), async (req, res): Promise<void> => {
  const { dateFrom, dateTo } = req.query;
  if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
    res.status(400).json({ error: "dateFrom and dateTo required (YYYY-MM-DD)" });
    return;
  }

  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T00:00:00");
  const periodDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  // Working days = calendar days excluding Saturdays (Sat is weekly off)
  const workingDaysInPeriod = countWorkingDays(fromDate, toDate);

  // Phase 1: fetch logs for the period (no rider-status filter)
  const logs = await db.select().from(dailyLogsTable).where(
    and(gte(dailyLogsTable.englishDate, dateFrom), lte(dailyLogsTable.englishDate, dateTo))
  );

  // Phase 2: derive which riders to include purely from log activity
  const riderIdsWithLogs = [...new Set(logs.map(l => l.riderId))];

  if (riderIdsWithLogs.length === 0) {
    res.json({ periodDays, entries: [] });
    return;
  }

  // Phase 3: fetch rider details + unapplied advances within the pay period only
  // Advances outside this period are not deducted here — they belong to their own period
  const [riders, advances, lockedPayRecords, payParams] = await Promise.all([
    db.select().from(ridersTable).where(inArray(ridersTable.id, riderIdsWithLogs)),
    db.select().from(salaryAdvancesTable).where(
      and(
        inArray(salaryAdvancesTable.riderId, riderIdsWithLogs),
        isNull(salaryAdvancesTable.appliedAt),
        gte(salaryAdvancesTable.date, dateFrom),
        lte(salaryAdvancesTable.date, dateTo)
      )
    ),
    // Locked Variable-Pay-Engine day records — the earnings source for pilots
    db.select().from(payRecordsTable).where(
      and(
        inArray(payRecordsTable.riderId, riderIdsWithLogs),
        eq(payRecordsTable.status, "locked"),
        gte(payRecordsTable.englishDate, dateFrom),
        lte(payRecordsTable.englishDate, dateTo)
      )
    ),
    getPayParams(dateTo),
  ]);

  const results = riders.map(rider => {
    // Determine effective working days (excl. Saturdays) in the rider's eligible period
    let effectiveDays = workingDaysInPeriod;
    let joiningMidPeriod = false;

    if (rider.joiningDate) {
      const joinDate = new Date(rider.joiningDate + "T00:00:00");
      if (joinDate > toDate) {
        // Rider joined after this period ended — exclude them
        effectiveDays = 0;
      } else if (joinDate > fromDate) {
        // Rider joined during the period — count working days from joining date
        effectiveDays = countWorkingDays(joinDate, toDate);
        joiningMidPeriod = true;
      }
      // joinDate <= fromDate: full period working days, no adjustment needed
    }

    if (effectiveDays === 0) return null;

    const riderLogs = logs.filter(l => l.riderId === rider.id);
    // daysWorked = actual log count — implicitly handles leaves & Saturday compensation
    const daysWorked = riderLogs.length;

    const timesTargetMissed = riderLogs.filter(l => {
      const target = l.dailyBonusSet ?? rider.dailyRideTarget ?? 0;
      return target > 0 && (l.ridesCompleted ?? 0) < target;
    }).length;

    const totalAllowances = riderLogs.reduce((s, l) => s + parseFloat(l.dailyAllowance || "0"), 0);

    // Cash variance: sum of daily cashCheck values (positive = rider short-paid → deduct; negative = rider over-paid → add back)
    const totalCashVariance = riderLogs.reduce((s, l) => s + parseFloat(l.cashCheck || "0"), 0);

    // All unapplied advances for this rider (carries forward from previous periods)
    const riderAdvances = advances.filter(a => a.riderId === rider.id);
    const totalAdvances = riderAdvances.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);

    // ── Earnings side: two tracks, same entry shape ──────────────────────────
    // Legacy: monthly rate prorated by days worked.
    // VPE (fleet pilots): the sum of the period's LOCKED Variable-Pay-Engine
    // day records — every rupee traceable to a day and formula line. All the
    // deductions below (allowances/advances/cash variance) apply identically:
    // they are money the rider already received or owes, whichever track
    // earned the pay.
    const riderPayRecords = lockedPayRecords.filter(r => r.riderId === rider.id);
    const isVpe = !!rider.fleetPilot;
    const daysLocked = riderPayRecords.length;
    const unlockedDays = isVpe ? Math.max(0, daysWorked - daysLocked) : 0;

    const monthly = parseFloat(rider.monthlySalary || "0");
    // Daily rate = monthly salary ÷ working days in the full calendar month(s).
    // If the period overlaps two calendar months, average the two per-day rates.
    const dailyRate = computeDailyRate(monthly, fromDate, toDate);
    const baseSalary = isVpe
      ? riderPayRecords.reduce((s, r) => s + parseFloat(r.dailyPay || "0"), 0)
      : dailyRate * daysWorked;

    // finalSalary subtracts allowances, advances, and net cash variance (positive variance = deduction, negative = addition)
    let finalSalary = Math.max(0, baseSalary - totalAllowances - totalAdvances - totalCashVariance);
    // VPE wage-law floor: full schedule worked but pay under the floor → top up.
    let floorApplied = false;
    if (isVpe && daysWorked >= effectiveDays && finalSalary < payParams.monthlyFloor) {
      finalSalary = payParams.monthlyFloor;
      floorApplied = true;
    }
    const flagged = timesTargetMissed >= 3;

    return {
      riderId: rider.id,
      riderName: rider.fullName,
      riderStatus: rider.status,
      joiningDate: rider.joiningDate ?? null,
      joiningMidPeriod,
      effectiveDays,
      daysWorked,
      timesTargetMissed,
      baseSalary: baseSalary.toFixed(2),
      totalAllowances: totalAllowances.toFixed(2),
      totalAdvances: totalAdvances.toFixed(2),
      totalCashVariance: totalCashVariance.toFixed(2),
      finalSalary: finalSalary.toFixed(2),
      flagged,
      advanceIds: riderAdvances.map(a => a.id),
      payModel: isVpe ? "vpe" : "legacy",
      ...(isVpe ? { daysLocked, unlockedDays, floorApplied } : {}),
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  results.sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || a.riderName.localeCompare(b.riderName));

  res.json({ periodDays, workingDays: workingDaysInPeriod, entries: results });
});

// ─── Process ───────────────────────────────────────────────────────────────

router.post("/salary/process", requirePermission("salary", "canCreate"), async (req, res): Promise<void> => {
  const { periodFrom, periodTo, entries, force } = req.body;
  if (!periodFrom || !periodTo || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "periodFrom, periodTo and entries[] required" });
    return;
  }

  if (!force) {
    const riderIds = entries.map((e: { riderId: number }) => e.riderId);
    const conflicts = await db
      .select({
        riderId: salaryPaymentsTable.riderId,
        periodFrom: salaryPaymentsTable.periodFrom,
        periodTo: salaryPaymentsTable.periodTo,
      })
      .from(salaryPaymentsTable)
      .where(
        and(
          inArray(salaryPaymentsTable.riderId, riderIds),
          lte(salaryPaymentsTable.periodFrom, periodTo),
          gte(salaryPaymentsTable.periodTo, periodFrom),
        )
      );
    if (conflicts.length > 0) {
      res.status(409).json({ error: "Duplicate payment detected", conflicts });
      return;
    }
  }

  // Validate: notes required when salaryProcessed differs from finalSalary
  const missingNotes = entries.filter((e: {
    finalSalary: string; salaryProcessed?: string; salaryDifference?: string; notes?: string;
  }) => {
    const diff = parseFloat(e.salaryDifference || "0");
    return Math.abs(diff) > 0.001 && !e.notes?.trim();
  });
  if (missingNotes.length > 0) {
    res.status(400).json({
      error: "Notes are required when Salary Processed differs from Final Salary.",
      riderIds: missingNotes.map((e: { riderId: number }) => e.riderId),
    });
    return;
  }

  const rows = entries.map((e: {
    riderId: number; daysWorked: number; timesTargetMissed: number;
    baseSalary: string; totalAllowances: string; totalAdvances: string;
    totalCashVariance?: string; finalSalary: string;
    salaryProcessed?: string; salaryDifference?: string;
    flagged: boolean; notes?: string; payModel?: string;
  }) => ({
    riderId: e.riderId,
    periodFrom,
    periodTo,
    daysWorked: e.daysWorked,
    timesTargetMissed: e.timesTargetMissed,
    baseSalary: e.baseSalary,
    totalAllowances: e.totalAllowances,
    totalAdvances: e.totalAdvances,
    totalCashVariance: e.totalCashVariance ?? "0.00",
    finalSalary: e.finalSalary,
    salaryProcessed: e.salaryProcessed ?? e.finalSalary,
    salaryDifference: e.salaryDifference ?? "0.00",
    payModel: e.payModel === "vpe" ? "vpe" : "legacy",
    flagged: e.flagged,
    processedBy: req.session.userName ?? "Unknown",
    notes: e.notes ?? null,
  }));

  const payments = await db.insert(salaryPaymentsTable).values(rows).returning();

  // Mark all used advances as applied — link them to their payment record
  const appliedAt = new Date();
  for (const payment of payments) {
    const entry = entries.find((e: { riderId: number; advanceIds?: number[] }) => e.riderId === payment.riderId);
    if (entry?.advanceIds?.length > 0) {
      await db.update(salaryAdvancesTable)
        .set({ appliedAt, salaryPaymentId: payment.id })
        .where(inArray(salaryAdvancesTable.id, entry.advanceIds));
    }
  }

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "salary",
    `Processed salary for ${rows.length} rider(s) — period ${periodFrom} to ${periodTo}`);
  res.status(201).json(payments);
});

// ─── Void Payment ──────────────────────────────────────────────────────────

router.delete("/salary/payments/:id", requirePermission("salary", "canDelete"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [payment] = await db.select().from(salaryPaymentsTable).where(eq(salaryPaymentsTable.id, id));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

  // Un-apply any advances that were consumed by this payment → return them to Pending
  await db.update(salaryAdvancesTable)
    .set({ appliedAt: null, salaryPaymentId: null })
    .where(eq(salaryAdvancesTable.salaryPaymentId, id));

  await db.delete(salaryPaymentsTable).where(eq(salaryPaymentsTable.id, id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "salary",
    `Voided salary payment ID ${id} for rider ${payment.riderId} — period ${payment.periodFrom} to ${payment.periodTo}`);
  res.sendStatus(204);
});

// ─── VPE day-by-day breakdown export (auditable payroll statement) ──────────

router.get("/salary/pay-records.csv", requirePermission("salary", "canView"), async (req, res): Promise<void> => {
  const { riderId, dateFrom, dateTo } = req.query as Record<string, string>;
  const rid = parseInt(riderId ?? "", 10);
  if (isNaN(rid) || !dateFrom || !dateTo) {
    res.status(400).json({ error: "riderId, dateFrom and dateTo required" });
    return;
  }
  const [rider] = await db.select({ name: ridersTable.fullName }).from(ridersTable).where(eq(ridersTable.id, rid));
  const records = await db
    .select()
    .from(payRecordsTable)
    .where(and(eq(payRecordsTable.riderId, rid), gte(payRecordsTable.englishDate, dateFrom), lte(payRecordsTable.englishDate, dateTo)))
    .orderBy(payRecordsTable.englishDate);

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Date", "Rides", "App Cash", "Bonus", "Revenue", "Hours", "Base", "Commission", "Prize", "Growth", "Streak Bonus", "Daily Pay", "Gates Hit", "Status"].join(","),
    ...records.map((r) => {
      const g = (r.gatesApplied ?? {}) as { inputs?: Record<string, unknown> };
      const f = (r.flags ?? {}) as Record<string, unknown>;
      const i = g.inputs ?? {};
      return [
        r.englishDate, i["rides"], i["appCash"], i["bonus"], i["revenue"], i["hours"],
        r.base, r.commission, r.prize, r.growth, f["streakBonus"] ?? 0, r.dailyPay,
        f["gatesHit"] ? "yes" : "no", r.status,
      ].map(esc).join(",");
    }),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pay-${(rider?.name ?? rid).toString().replace(/[^a-zA-Z0-9]+/g, "-")}-${dateFrom}-to-${dateTo}.csv"`);
  res.send("﻿" + lines.join("\n"));
});

// ─── Pay Engine config (Variable Pay Model v2 — versioned parameters) ───────

router.get("/salary/pay-config", requirePermission("salary", "canView"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(payConfigTable).orderBy(payConfigTable.parameter, desc(payConfigTable.effectiveFrom));
  res.json({ rows, defaults: DEFAULT_PARAMS });
});

const PayConfigBody = z.object({
  parameter: z.enum([
    "fleet_enabled", "base_amount", "base_min_hours", "base_min_rides",
    "commission_rate", "revenue_cap", "growth_rate", "ramp",
    "streak_length", "streak_bonus", "monthly_floor", "yango_bonus_table",
  ]),
  value: z.string().min(1).max(2000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post("/salary/pay-config", requirePermission("salary", "canEdit"), async (req, res): Promise<void> => {
  const parsed = PayConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { parameter, value, effectiveFrom } = parsed.data;

  if (parameter === "ramp") {
    try {
      const ramp = JSON.parse(value);
      if (!Array.isArray(ramp) || ramp.some((t) => typeof t?.fromDay !== "number" || typeof t?.gateRides !== "number" || typeof t?.gateCash !== "number" || typeof t?.prize !== "number")) {
        throw new Error("bad shape");
      }
    } catch {
      res.status(400).json({ error: "Ramp must be a JSON array of {fromDay, toDay, gateRides, gateCash, prize}." });
      return;
    }
  } else if (parameter === "yango_bonus_table") {
    try {
      const table = JSON.parse(value);
      if (!Array.isArray(table) || table.length === 0 || table.some((t) => typeof t?.trips !== "number" || typeof t?.pct !== "number" || typeof t?.max !== "number")) {
        throw new Error("bad shape");
      }
    } catch {
      res.status(400).json({ error: "Yango bonus table must be a JSON array of {trips, pct, max}." });
      return;
    }
  } else if (parameter === "fleet_enabled") {
    if (value !== "true" && value !== "false") { res.status(400).json({ error: "fleet_enabled must be 'true' or 'false'." }); return; }
  } else if (!/^-?\d+(\.\d+)?$/.test(value)) {
    res.status(400).json({ error: "Value must be a number." });
    return;
  }

  try {
    const [row] = await db.insert(payConfigTable).values({ parameter, value, effectiveFrom }).returning();
    logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "salary",
      `Pay config: ${parameter} = ${value.length > 60 ? value.slice(0, 60) + "…" : value} effective ${effectiveFrom}`);
    res.status(201).json(row);
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e?.code === "23505" || e?.cause?.code === "23505") {
      res.status(409).json({ error: `${parameter} already has a value effective ${effectiveFrom} — pick a different date.` });
      return;
    }
    throw err;
  }
});

// ─── History ───────────────────────────────────────────────────────────────

router.get("/salary/history", requirePermission("salary", "canView"), async (req, res): Promise<void> => {
  const payments = await db.select().from(salaryPaymentsTable).orderBy(salaryPaymentsTable.processedAt);
  const riders = await db.select({ id: ridersTable.id, fullName: ridersTable.fullName }).from(ridersTable);
  const riderMap = new Map(riders.map(r => [r.id, r.fullName]));
  res.json(payments.map(p => ({ ...p, riderName: riderMap.get(p.riderId) ?? "Unknown" })).reverse());
});

export default router;
