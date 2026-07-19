import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db, dailyLogsTable, ridersTable, vehiclesTable, payRecordsTable, cashCollectionsTable } from "@workspace/db";
import {
  ListDailyLogsQueryParams,
  CreateDailyLogBody,
  UpdateDailyLogParams,
  UpdateDailyLogBody,
  DeleteDailyLogParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";
import { computeAndLockPay } from "../lib/pay-engine";

const router: IRouter = Router();

const dailyLogSelect = {
  id: dailyLogsTable.id,
  riderId: dailyLogsTable.riderId,
  vehicleId: dailyLogsTable.vehicleId,
  riderName: ridersTable.fullName,
  vehiclePlate: vehiclesTable.plateNumber,
  nepaliDate: dailyLogsTable.nepaliDate,
  englishDate: dailyLogsTable.englishDate,
  checkInTime: dailyLogsTable.checkInTime,
  checkOutTime: dailyLogsTable.checkOutTime,
  dailyBonusSet: dailyLogsTable.dailyBonusSet,
  totalRidesReceived: dailyLogsTable.totalRidesReceived,
  ridesCompleted: dailyLogsTable.ridesCompleted,
  acceptanceRate: dailyLogsTable.acceptanceRate,
  bonusTargetCompletion: dailyLogsTable.bonusTargetCompletion,
  totalRideDistanceKm: dailyLogsTable.totalRideDistanceKm,
  totalRideHours: dailyLogsTable.totalRideHours,
  totalAppOnline: dailyLogsTable.totalAppOnline,
  cashAsPerApp: dailyLogsTable.cashAsPerApp,
  goalBonus: dailyLogsTable.goalBonus,
  promotionBonusOther: dailyLogsTable.promotionBonusOther,
  totalIncome: dailyLogsTable.totalIncome,
  cashGivenByDriver: dailyLogsTable.cashGivenByDriver,
  cashTransferredOnline: dailyLogsTable.cashTransferredOnline,
  cashCheck: dailyLogsTable.cashCheck,
  dailyAllowance: dailyLogsTable.dailyAllowance,
  remarks: dailyLogsTable.remarks,
  isDraft: dailyLogsTable.isDraft,
  yangoSyncedAt: dailyLogsTable.yangoSyncedAt,
  createdAt: dailyLogsTable.createdAt,
};

router.get("/daily-logs", requirePermission("daily-logs", "canView"), async (req, res): Promise<void> => {
  const query = ListDailyLogsQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.riderId) {
    conditions.push(eq(dailyLogsTable.riderId, query.data.riderId));
  }
  if (query.success && query.data.vehicleId) {
    conditions.push(eq(dailyLogsTable.vehicleId, query.data.vehicleId));
  }
  if (query.success && query.data.startDate) {
    conditions.push(gte(dailyLogsTable.englishDate, String(query.data.startDate)));
  }
  if (query.success && query.data.endDate) {
    conditions.push(lte(dailyLogsTable.englishDate, String(query.data.endDate)));
  }

  const rows = await db
    .select(dailyLogSelect)
    .from(dailyLogsTable)
    .leftJoin(ridersTable, eq(dailyLogsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(dailyLogsTable.vehicleId, vehiclesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(dailyLogsTable.englishDate), desc(dailyLogsTable.id));

  res.json(rows);
});

router.post("/daily-logs", requirePermission("daily-logs", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateDailyLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select({ id: dailyLogsTable.id })
    .from(dailyLogsTable)
    .where(
      and(
        eq(dailyLogsTable.riderId, parsed.data.riderId),
        eq(dailyLogsTable.englishDate, parsed.data.englishDate)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({
      error: `A daily log already exists for this rider on ${parsed.data.englishDate}. Edit the existing entry instead.`,
      existingId: existing[0].id,
    });
    return;
  }

  const [log] = await db.insert(dailyLogsTable).values(parsed.data).returning();

  const [row] = await db
    .select(dailyLogSelect)
    .from(dailyLogsTable)
    .leftJoin(ridersTable, eq(dailyLogsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(dailyLogsTable.vehicleId, vehiclesTable.id))
    .where(eq(dailyLogsTable.id, log.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "daily-logs", `Created daily log for ${row?.riderName ?? `rider #${log.riderId}`} on ${log.englishDate}`);
  res.status(201).json(row);
});

router.put("/daily-logs/:id", requirePermission("daily-logs", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateDailyLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDailyLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [log] = await db.update(dailyLogsTable).set({ ...parsed.data, isDraft: false }).where(eq(dailyLogsTable.id, params.data.id)).returning();
  if (!log) {
    res.status(404).json({ error: "Daily log not found" });
    return;
  }

  const [row] = await db
    .select(dailyLogSelect)
    .from(dailyLogsTable)
    .leftJoin(ridersTable, eq(dailyLogsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(dailyLogsTable.vehicleId, vehiclesTable.id))
    .where(eq(dailyLogsTable.id, log.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "daily-logs", `Updated daily log for ${row?.riderName ?? `rider #${log.riderId}`} on ${log.englishDate}`);

  // Pay-engine hook, order-proof: if this day is already locked, recompute
  // (with old -> new audit). If it is NOT locked yet but the day's cash is
  // already approved — finance clicked before ops confirmed the log — fire
  // the first lock now, since this edit just finalized the log. Whichever of
  // the two clicks happens second triggers the pay. No-op for non-pilots.
  lockOrRecomputePay(log.riderId, log.englishDate, req.session.userId ?? null, req.session.userName ?? "Unknown");

  res.json(row);
});

function lockOrRecomputePay(riderId: number, date: string, userId: number | null, userName: string): void {
  (async () => {
    const [rec] = await db
      .select({ id: payRecordsTable.id })
      .from(payRecordsTable)
      .where(and(eq(payRecordsTable.riderId, riderId), eq(payRecordsTable.englishDate, date)));
    if (!rec) {
      const [cc] = await db
        .select({ status: cashCollectionsTable.approvalStatus })
        .from(cashCollectionsTable)
        .where(and(eq(cashCollectionsTable.riderId, riderId), eq(cashCollectionsTable.englishDate, date)));
      if (cc?.status !== "approved") return; // first lock still belongs to the cash-approval hook
    }
    await computeAndLockPay(riderId, date, { userId, userName });
  })().catch((err) => console.error("[pay-engine] lock/recompute failed (non-fatal):", err));
}

router.delete("/daily-logs/:id", requirePermission("daily-logs", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteDailyLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [log] = await db.delete(dailyLogsTable).where(eq(dailyLogsTable.id, params.data.id)).returning();
  if (!log) {
    res.status(404).json({ error: "Daily log not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "daily-logs", `Deleted daily log for rider #${log.riderId} on ${log.englishDate}`);
  res.sendStatus(204);
});

export default router;
