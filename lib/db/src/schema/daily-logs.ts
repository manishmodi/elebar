import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ridersTable } from "./riders";
import { vehiclesTable } from "./vehicles";

export const dailyLogsTable = pgTable("daily_logs", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  nepaliDate: text("nepali_date"),
  englishDate: text("english_date").notNull(),
  checkInTime: text("check_in_time"),
  checkOutTime: text("check_out_time"),
  dailyBonusSet: integer("daily_bonus_set"),
  totalRidesReceived: integer("total_rides_received"),
  ridesCompleted: integer("rides_completed"),
  acceptanceRate: text("acceptance_rate"),
  bonusTargetCompletion: boolean("bonus_target_completion"),
  totalRideDistanceKm: text("total_ride_distance_km"),
  totalRideHours: text("total_ride_hours"),
  totalAppOnline: text("total_app_online"),
  cashAsPerApp: text("cash_as_per_app"),
  goalBonus: text("goal_bonus"),
  promotionBonusOther: text("promotion_bonus_other"),
  totalIncome: text("total_income"),
  cashGivenByDriver: text("cash_given_by_driver"),
  cashTransferredOnline: text("cash_transferred_online"),
  cashCheck: text("cash_check"),
  dailyAllowance: text("daily_allowance"),
  additionalExpenses: text("additional_expenses"),
  remarks: text("remarks"),
  isDraft: boolean("is_draft").default(false).notNull(),
  yangoSyncedAt: timestamp("yango_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyLogSchema = createInsertSchema(dailyLogsTable).omit({ id: true, createdAt: true });
export type InsertDailyLog = z.infer<typeof insertDailyLogSchema>;
export type DailyLog = typeof dailyLogsTable.$inferSelect;
