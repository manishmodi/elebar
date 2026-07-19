import { db, ridersTable, dailyLogsTable, vehiclesTable, assignmentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  isConfigured,
  getOrdersForDriver,
  getTransactionsForDriver,
  getSupplyHours,
} from "./yango-client.js";

// Nepal timezone offset: UTC+5:45
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

export interface SyncResult {
  date: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Build Nepal-local ISO timestamps for start/end of a given YYYY-MM-DD date in Nepal time.
 */
function nepalDayRange(date: string): { from: string; to: string } {
  const from = `${date}T00:00:00+05:45`;
  const to = `${date}T23:59:59+05:45`;
  return { from, to };
}

/**
 * Add one calendar day to a YYYY-MM-DD date string.
 */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Get today's date in Nepal local time (YYYY-MM-DD).
 */
export function getTodayNepal(): string {
  const nepalNow = new Date(Date.now() + NEPAL_OFFSET_MINUTES * 60 * 1000);
  return nepalNow.toISOString().slice(0, 10);
}

/**
 * Get yesterday's date in Nepal local time (YYYY-MM-DD).
 */
export function getYesterdayNepal(): string {
  const utcNow = Date.now();
  const nepalNow = new Date(utcNow + NEPAL_OFFSET_MINUTES * 60 * 1000);
  nepalNow.setDate(nepalNow.getDate() - 1);
  return nepalNow.toISOString().slice(0, 10);
}

/**
 * Main sync function. Fetches Yango data for all linked riders for a given date and creates/updates draft logs.
 */
export async function syncForDate(date: string): Promise<SyncResult> {
  const startedAt = Date.now();
  const result: SyncResult = { date, processed: 0, created: 0, updated: 0, skipped: 0, errors: [] };

  if (!isConfigured()) {
    result.errors.push("Yango API credentials not configured (YANGO_CLIENT_ID, YANGO_API_KEY, YANGO_PARK_ID)");
    return result;
  }

  // Get all riders that have a Yango driver ID linked
  const riders = await db.select().from(ridersTable).where(
    and(
      eq(ridersTable.status, "active"),
    )
  );
  const linkedRiders = riders.filter(r => r.yangoDriverId);

  if (linkedRiders.length === 0) {
    result.errors.push("No riders linked to Yango driver profiles yet");
    return result;
  }

  const { from, to } = nepalDayRange(date);
  // Goal bonus for a given work day is posted by Yango in the NEXT day's statement
  const nextDate = nextDay(date);
  const { from: bonusFrom, to: bonusTo } = nepalDayRange(nextDate);

  for (const rider of linkedRiders) {
    result.processed++;
    try {
      const driverId = rider.yangoDriverId!;

      // Fetch ride data (orders + supply) for selected date,
      // and transactions for BOTH selected date (cash/promo) and next day (goal bonus)
      const [orders, transactions, nextDayTransactions, supplySeconds] = await Promise.all([
        getOrdersForDriver(driverId, from, to),
        getTransactionsForDriver(driverId, from, to),
        getTransactionsForDriver(driverId, bonusFrom, bonusTo),
        getSupplyHours(driverId, from, to),
      ]);

      // Skip riders who had zero activity on this date — no rides and no online time
      if (orders.length === 0 && supplySeconds === 0) {
        result.skipped++;
        console.log(`[Yango Sync] Skipping ${rider.fullName} — no activity on ${date}`);
        continue;
      }

      // Aggregate order stats
      const completedOrders = orders.filter(o => o.status === "complete");
      const ridesCompleted = completedOrders.length;
      const totalRidesReceived = orders.length;

      const acceptanceRate = totalRidesReceived > 0
        ? ((ridesCompleted / totalRidesReceived) * 100).toFixed(1)
        : null;

      // Yango returns mileage in METERS — convert to km
      const totalDistanceKm = (completedOrders.reduce(
        (sum, o) => sum + parseFloat(o.mileage ?? "0"), 0
      ) / 1000).toFixed(2);

      const totalIncome = completedOrders.reduce(
        (sum, o) => sum + parseFloat(o.price ?? "0"), 0
      ).toFixed(2);

      // App Cash: use Yango's cash_collected transaction sum (more accurate than order price sum)
      const cashIncome = transactions
        .filter(t => t.group_id === "cash_collected")
        .reduce((sum, t) => sum + parseFloat(t.amount), 0)
        .toFixed(2);

      // Promo & Others: platform_promotion + same-day platform_bonus entries that have an order_id
      // Per-trip bonuses (Bonus column in Yango portal) are tied to a specific order (order_id set)
      // Goal bonus batch payouts have NO order_id — those must NOT be included here
      const promoBonus = transactions
        .filter(t => t.group_id === "platform_promotion" || (t.group_id === "platform_bonus" && t.order_id))
        .reduce((sum, t) => sum + parseFloat(t.amount), 0)
        .toFixed(2);

      // Goal Bonus: next day's platform_bonus entries that have NO order_id (batch payout)
      const goalBonus = nextDayTransactions
        .filter(t => t.group_id === "platform_bonus" && !t.order_id)
        .reduce((sum, t) => sum + parseFloat(t.amount), 0)
        .toFixed(2);

      // Convert supply seconds to hours:minutes
      const supplyHours = supplySeconds > 0
        ? `${Math.floor(supplySeconds / 3600)}:${String(Math.floor((supplySeconds % 3600) / 60)).padStart(2, "0")}`
        : null;

      // Check for existing log for this rider+date
      const existing = await db.select().from(dailyLogsTable).where(
        and(
          eq(dailyLogsTable.riderId, rider.id),
          eq(dailyLogsTable.englishDate, date),
        )
      );

      if (existing.length > 0) {
        const log = existing[0];
        // Only update if it's still a draft — never overwrite manually confirmed logs
        if (!log.isDraft) {
          result.skipped++;
          continue;
        }
        await db.update(dailyLogsTable).set({
          ridesCompleted: ridesCompleted || null,
          totalRidesReceived: totalRidesReceived || null,
          acceptanceRate,
          totalRideDistanceKm: totalDistanceKm,
          totalIncome,
          cashAsPerApp: cashIncome,
          goalBonus,
          promotionBonusOther: promoBonus,
          totalAppOnline: supplyHours,
          yangoSyncedAt: new Date(),
        }).where(eq(dailyLogsTable.id, log.id));
        result.updated++;
      } else {
        // Find the rider's assigned vehicle (most recent active assignment)
        const [activeAssignment] = await db
          .select({ vehicleId: assignmentsTable.vehicleId })
          .from(assignmentsTable)
          .where(and(eq(assignmentsTable.riderId, rider.id), eq(assignmentsTable.status, "active")))
          .orderBy(desc(assignmentsTable.id))
          .limit(1);

        // Fallback: get first active vehicle
        let vehicleId: number | null = activeAssignment?.vehicleId ?? null;
        if (!vehicleId) {
          const [firstVehicle] = await db.select({ id: vehiclesTable.id })
            .from(vehiclesTable)
            .where(eq(vehiclesTable.status, "active"));
          vehicleId = firstVehicle?.id ?? null;
        }

        if (!vehicleId) {
          result.errors.push(`No vehicle found for rider ${rider.fullName} — skipping`);
          result.skipped++;
          continue;
        }

        await db.insert(dailyLogsTable).values({
          riderId: rider.id,
          vehicleId,
          englishDate: date,
          ridesCompleted: ridesCompleted || null,
          totalRidesReceived: totalRidesReceived || null,
          acceptanceRate,
          totalRideDistanceKm: totalDistanceKm,
          totalIncome,
          cashAsPerApp: cashIncome,
          goalBonus,
          promotionBonusOther: promoBonus,
          totalAppOnline: supplyHours,
          isDraft: true,
          yangoSyncedAt: new Date(),
        });
        result.created++;
      }
    } catch (err: any) {
      result.errors.push(`Rider ${rider.fullName}: ${err?.message ?? String(err)}`);
    }
  }

  console.log(`[Yango Sync] ${date} — processed: ${result.processed}, created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors.length} (took ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  return result;
}

export interface PreviewRider {
  riderId: number;
  riderName: string;
  yangoDriverId: string;
  status: "new" | "draft_exists" | "finalized_exists" | "error";
  existingLogId?: number;
  error?: string;
  // Yango data
  ridesCompleted?: number;
  totalRidesReceived?: number;
  acceptanceRate?: string;
  totalRideDistanceKm?: string;
  totalIncome?: string;
  cashAsPerApp?: string;
  goalBonus?: string;
  promotionBonusOther?: string;
  totalAppOnline?: string;
}

export interface PreviewResult {
  date: string;
  riders: PreviewRider[];
}

/**
 * Persist already-computed preview rider stats to draft logs WITHOUT re-fetching Yango.
 * Used by the Approve action so the user doesn't re-trigger the rate-limited Yango fetch
 * (which often exceeds the deployment HTTP timeout when there are many linked riders).
 */
export async function persistFromPreview(date: string, riders: PreviewRider[]): Promise<SyncResult> {
  const result: SyncResult = { date, processed: 0, created: 0, updated: 0, skipped: 0, errors: [] };

  // Guardrail: only accept rider IDs that are currently active AND linked to a Yango driver.
  // The fast path trusts client-supplied stats (caller has daily-logs.canCreate), but we
  // refuse unknown / unlinked rider IDs so the payload can't fabricate logs for arbitrary riders.
  const allowedRiderIds = new Set(
    (await db.select({ id: ridersTable.id }).from(ridersTable).where(eq(ridersTable.status, "active")))
      .map(r => r.id)
  );

  for (const r of riders) {
    if (r.status === "error" || r.status === "finalized_exists") {
      result.skipped++;
      continue;
    }
    if (!allowedRiderIds.has(r.riderId)) {
      result.skipped++;
      result.errors.push(`Rider ${r.riderName ?? r.riderId}: not an active rider — skipped`);
      continue;
    }
    result.processed++;
    try {
      const ridesCompleted = r.ridesCompleted ?? 0;
      const totalRidesReceived = r.totalRidesReceived ?? 0;
      const acceptanceRate = r.acceptanceRate ?? null;
      const totalDistanceKm = r.totalRideDistanceKm ?? "0.00";
      const totalIncome = r.totalIncome ?? "0.00";
      const cashIncome = r.cashAsPerApp ?? "0.00";
      const goalBonus = r.goalBonus ?? "0.00";
      const promoBonus = r.promotionBonusOther ?? "0.00";
      const supplyHours = r.totalAppOnline ?? null;

      const existing = await db.select().from(dailyLogsTable).where(
        and(eq(dailyLogsTable.riderId, r.riderId), eq(dailyLogsTable.englishDate, date))
      );

      if (existing.length > 0) {
        const log = existing[0];
        if (!log.isDraft) {
          result.skipped++;
          continue;
        }
        await db.update(dailyLogsTable).set({
          ridesCompleted: ridesCompleted || null,
          totalRidesReceived: totalRidesReceived || null,
          acceptanceRate,
          totalRideDistanceKm: totalDistanceKm,
          totalIncome,
          cashAsPerApp: cashIncome,
          goalBonus,
          promotionBonusOther: promoBonus,
          totalAppOnline: supplyHours,
          yangoSyncedAt: new Date(),
        }).where(eq(dailyLogsTable.id, log.id));
        result.updated++;
      } else {
        const [activeAssignment] = await db
          .select({ vehicleId: assignmentsTable.vehicleId })
          .from(assignmentsTable)
          .where(and(eq(assignmentsTable.riderId, r.riderId), eq(assignmentsTable.status, "active")))
          .orderBy(desc(assignmentsTable.id))
          .limit(1);
        let vehicleId: number | null = activeAssignment?.vehicleId ?? null;
        if (!vehicleId) {
          const [firstVehicle] = await db.select({ id: vehiclesTable.id })
            .from(vehiclesTable)
            .where(eq(vehiclesTable.status, "active"));
          vehicleId = firstVehicle?.id ?? null;
        }
        if (!vehicleId) {
          result.errors.push(`No vehicle found for rider ${r.riderName} — skipping`);
          result.skipped++;
          continue;
        }
        await db.insert(dailyLogsTable).values({
          riderId: r.riderId,
          vehicleId,
          englishDate: date,
          ridesCompleted: ridesCompleted || null,
          totalRidesReceived: totalRidesReceived || null,
          acceptanceRate,
          totalRideDistanceKm: totalDistanceKm,
          totalIncome,
          cashAsPerApp: cashIncome,
          goalBonus,
          promotionBonusOther: promoBonus,
          totalAppOnline: supplyHours,
          isDraft: true,
          yangoSyncedAt: new Date(),
        });
        result.created++;
      }
    } catch (err: any) {
      result.errors.push(`Rider ${r.riderName}: ${err?.message ?? String(err)}`);
    }
  }

  console.log(`[Yango Sync] ${date} (from preview) — processed: ${result.processed}, created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors.length}`);
  return result;
}

/**
 * Preview-only: fetches Yango data for all linked riders on a given date WITHOUT writing to DB.
 */
export async function previewForDate(
  date: string,
  onProgress?: (completed: number, total: number) => void,
  riderIds?: number[] | null,
): Promise<PreviewResult> {
  const startedAt = Date.now();
  const result: PreviewResult = { date, riders: [] };

  if (!isConfigured()) {
    throw new Error("Yango API credentials not configured");
  }

  const riders = await db.select().from(ridersTable).where(eq(ridersTable.status, "active"));
  let linkedRiders = riders.filter(r => r.yangoDriverId);
  // Optional scoping: when the caller picks specific riders, only sync those.
  // Empty/absent => all linked riders (default behaviour).
  if (riderIds && riderIds.length > 0) {
    const wanted = new Set(riderIds);
    linkedRiders = linkedRiders.filter(r => wanted.has(r.id));
  }

  if (linkedRiders.length === 0) {
    onProgress?.(0, 0);
    return result;
  }

  const total = linkedRiders.length;
  let completed = 0;
  onProgress?.(0, total);

  const { from, to } = nepalDayRange(date);
  // Goal bonus for a given work day is posted by Yango in the NEXT day's statement
  const nextDate = nextDay(date);
  const { from: bonusFrom, to: bonusTo } = nepalDayRange(nextDate);

  for (const rider of linkedRiders) {
    const entry: PreviewRider = {
      riderId: rider.id,
      riderName: rider.fullName,
      yangoDriverId: rider.yangoDriverId!,
      status: "new",
    };

    try {
      // Check for existing log
      const existing = await db.select().from(dailyLogsTable).where(
        and(eq(dailyLogsTable.riderId, rider.id), eq(dailyLogsTable.englishDate, date))
      );
      if (existing.length > 0) {
        const log = existing[0];
        entry.existingLogId = log.id;
        entry.status = log.isDraft ? "draft_exists" : "finalized_exists";
        if (!log.isDraft) {
          result.riders.push(entry);
          completed++;
          onProgress?.(completed, total);
          continue;
        }
      }

      // Fetch ride data for selected date + next day transactions for goal bonus
      const [orders, transactions, nextDayTransactions, supplySeconds] = await Promise.all([
        getOrdersForDriver(rider.yangoDriverId!, from, to),
        getTransactionsForDriver(rider.yangoDriverId!, from, to),
        getTransactionsForDriver(rider.yangoDriverId!, bonusFrom, bonusTo),
        getSupplyHours(rider.yangoDriverId!, from, to),
      ]);

      // Skip riders with no activity on this date — don't show in preview or create drafts
      if (orders.length === 0 && supplySeconds === 0) {
        console.log(`[Yango Preview] Skipping ${rider.fullName} — no activity on ${date}`);
        completed++;
        onProgress?.(completed, total);
        continue;
      }

      const completedOrders = orders.filter(o => o.status === "complete");
      const ridesCompleted = completedOrders.length;
      const totalRidesReceived = orders.length;

      entry.ridesCompleted = ridesCompleted;
      entry.totalRidesReceived = totalRidesReceived;
      entry.acceptanceRate = totalRidesReceived > 0
        ? ((ridesCompleted / totalRidesReceived) * 100).toFixed(1)
        : undefined;
      // Yango returns mileage in METERS — convert to km
      entry.totalRideDistanceKm = (completedOrders.reduce((s, o) => s + parseFloat(o.mileage ?? "0"), 0) / 1000).toFixed(2);
      entry.totalIncome = completedOrders.reduce((s, o) => s + parseFloat(o.price ?? "0"), 0).toFixed(2);
      // App Cash: from cash_collected transactions (more accurate than order price sum)
      entry.cashAsPerApp = transactions
        .filter(t => t.group_id === "cash_collected")
        .reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(2);
      // Goal Bonus: next day's platform_bonus with NO order_id (batch goal payout)
      entry.goalBonus = nextDayTransactions
        .filter(t => t.group_id === "platform_bonus" && !t.order_id)
        .reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(2);
      // Promo & Others: platform_promotion + same-day platform_bonus WITH order_id (per-trip bonuses only)
      entry.promotionBonusOther = transactions
        .filter(t => t.group_id === "platform_promotion" || (t.group_id === "platform_bonus" && t.order_id))
        .reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(2);
      entry.totalAppOnline = supplySeconds > 0
        ? `${Math.floor(supplySeconds / 3600)}:${String(Math.floor((supplySeconds % 3600) / 60)).padStart(2, "0")}`
        : undefined;
    } catch (err: any) {
      entry.status = "error";
      entry.error = err?.message ?? String(err);
    }

    result.riders.push(entry);
    completed++;
    onProgress?.(completed, total);
  }

  console.log(`[Yango Preview] ${date} — ${result.riders.length} riders with activity (took ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  return result;
}
