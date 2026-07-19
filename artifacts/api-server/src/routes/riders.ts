import { Router, type IRouter } from "express";
import { eq, ilike, and, or, gte, lte, count } from "drizzle-orm";
import {
  db,
  ridersTable,
  dailyLogsTable,
  assignmentsTable,
  attendanceTable,
  fleetHandoversTable,
  payRecordsTable,
  riderInsertSchema,
  riderUpdateSchema,
} from "@workspace/db";
import {
  ListRidersQueryParams,
  GetRiderParams,
  UpdateRiderParams,
  DeleteRiderParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const router: IRouter = Router();

router.get("/riders", requirePermission("riders", "canView"), async (req, res): Promise<void> => {
  const query = ListRidersQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) {
    conditions.push(eq(ridersTable.status, query.data.status));
  }
  if (query.success && query.data.search) {
    conditions.push(
      or(
        ilike(ridersTable.fullName, `%${query.data.search}%`),
        ilike(ridersTable.phoneNumber, `%${query.data.search}%`)
      )
    );
  }

  const riders = await db
    .select()
    .from(ridersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(ridersTable.id);

  res.json(riders);
});

router.get("/riders/stats", requirePermission("riders", "canView"), async (req, res): Promise<void> => {
  const { dateFrom, dateTo } = req.query;
  if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
    res.status(400).json({ error: "dateFrom and dateTo query params required (YYYY-MM-DD)" });
    return;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    return;
  }
  if (dateFrom > dateTo) {
    res.status(400).json({ error: "dateFrom must not be after dateTo." });
    return;
  }

  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T00:00:00");
  const numberOfDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Working days = calendar days excluding Saturdays (weekly off)
  const countWorkingDays = (from: Date, to: Date): number => {
    let count = 0;
    const d = new Date(from);
    while (d <= to) {
      if (d.getDay() !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return Math.max(1, count);
  };
  const workingDays = countWorkingDays(fromDate, toDate);

  // Previous period: same calendar length, ending the day before current start
  const prevToDate = new Date(fromDate);
  prevToDate.setDate(prevToDate.getDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setDate(prevFromDate.getDate() - (numberOfDays - 1));
  const prevDateFrom = prevFromDate.toISOString().split("T")[0];
  const prevDateTo = prevToDate.toISOString().split("T")[0];
  const prevWorkingDays = countWorkingDays(prevFromDate, prevToDate);

  const [logs, prevLogs] = await Promise.all([
    db.select().from(dailyLogsTable).where(
      and(gte(dailyLogsTable.englishDate, dateFrom), lte(dailyLogsTable.englishDate, dateTo))
    ),
    db.select().from(dailyLogsTable).where(
      and(gte(dailyLogsTable.englishDate, prevDateFrom), lte(dailyLogsTable.englishDate, prevDateTo))
    ),
  ]);

  const grouped: Record<number, { rides: number; income: number }> = {};
  for (const l of logs) {
    if (!grouped[l.riderId]) grouped[l.riderId] = { rides: 0, income: 0 };
    grouped[l.riderId].rides += l.ridesCompleted || 0;
    grouped[l.riderId].income += parseFloat(l.totalIncome || "0");
  }

  const prevGrouped: Record<number, { rides: number }> = {};
  for (const l of prevLogs) {
    if (!prevGrouped[l.riderId]) prevGrouped[l.riderId] = { rides: 0 };
    prevGrouped[l.riderId].rides += l.ridesCompleted || 0;
  }

  const stats = Object.entries(grouped).map(([riderId, data]) => {
    const id = parseInt(riderId, 10);
    const avgRides = data.rides / workingDays;
    const avgRevenue = data.income / workingDays;

    const prev = prevGrouped[id];
    let avgRidesGrowth: number | null = null;
    if (prev && prev.rides > 0) {
      const prevAvg = prev.rides / prevWorkingDays;
      avgRidesGrowth = parseFloat((((avgRides - prevAvg) / prevAvg) * 100).toFixed(1));
    }

    return {
      riderId: id,
      avgRidesPerDay: avgRides.toFixed(1),
      avgRevenuePerDay: avgRevenue.toFixed(2),
      avgRidesGrowth,
    };
  });

  res.json(stats);
});

router.post("/riders", requirePermission("riders", "canCreate"), async (req, res): Promise<void> => {
  const parsed = riderInsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [rider] = await db.insert(ridersTable).values(parsed.data).returning();
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "riders", `Created rider: ${rider.fullName}`);
  res.status(201).json(rider);
});

router.get("/riders/:id", requirePermission("riders", "canView"), async (req, res): Promise<void> => {
  const params = GetRiderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.id, params.data.id));
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }
  res.json(rider);
});

router.put("/riders/:id", requirePermission("riders", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateRiderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = riderUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [rider] = await db.update(ridersTable).set(parsed.data).where(eq(ridersTable.id, params.data.id)).returning();
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "riders", `Updated rider: ${rider.fullName}`);
  res.json(rider);
});

router.delete("/riders/:id", requirePermission("riders", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteRiderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rid = params.data.id;

  const [[{ value: logCount }], [{ value: assignCount }], [{ value: attCount }], [{ value: handoverCount }], [{ value: payCount }]] = await Promise.all([
    db.select({ value: count() }).from(dailyLogsTable).where(eq(dailyLogsTable.riderId, rid)),
    db.select({ value: count() }).from(assignmentsTable).where(eq(assignmentsTable.riderId, rid)),
    db.select({ value: count() }).from(attendanceTable).where(eq(attendanceTable.riderId, rid)),
    db.select({ value: count() }).from(fleetHandoversTable).where(eq(fleetHandoversTable.riderId, rid)),
    db.select({ value: count() }).from(payRecordsTable).where(eq(payRecordsTable.riderId, rid)),
  ]);

  if (logCount > 0 || assignCount > 0 || attCount > 0 || handoverCount > 0 || payCount > 0) {
    const parts: string[] = [];
    if (logCount > 0) parts.push(`${logCount} daily log(s)`);
    if (assignCount > 0) parts.push(`${assignCount} assignment(s)`);
    if (attCount > 0) parts.push(`${attCount} attendance record(s)`);
    if (handoverCount > 0) parts.push(`${handoverCount} fleet handover(s)`);
    if (payCount > 0) parts.push(`${payCount} pay record(s)`);
    res.status(409).json({
      error: `Cannot delete rider — it has ${parts.join(", ")}. Set it to Inactive instead.`,
    });
    return;
  }

  try {
    const [rider] = await db.delete(ridersTable).where(eq(ridersTable.id, rid)).returning();
    if (!rider) {
      res.status(404).json({ error: "Rider not found" });
      return;
    }
    logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "riders", `Deleted rider: ${rider.fullName}`);
    res.sendStatus(204);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23503") {
      res.status(409).json({ error: "Cannot delete rider — it still has linked records. Set it to Inactive instead." });
      return;
    }
    throw err;
  }
});

export default router;
