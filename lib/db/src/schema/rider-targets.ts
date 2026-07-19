import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { ridersTable } from "./riders";

// Yango auto-targeting tables. These exist in the production DB but were missing
// from the repo schema; defined here (matching prod's exact columns) so the data
// syncs and prod parity is complete. Not yet referenced by app code.

export const riderDailyTargetsTable = pgTable("rider_daily_targets", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  date: text("date").notNull(),
  workingDayCount: integer("working_day_count").notNull().default(0),
  avg7day: text("avg_7day"),
  tier: text("tier").notNull().default("new"),
  tierAdj: integer("tier_adj").notNull().default(0),
  tierCStreak: integer("tier_c_streak").notNull().default(0),
  improvementStreak: integer("improvement_streak").notNull().default(0),
  tierCAccel: boolean("tier_c_accel").notNull().default(false),
  calculatedTarget: integer("calculated_target").notNull(),
  finalTarget: integer("final_target").notNull(),
  needsHrReview: boolean("needs_hr_review").notNull().default(false),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riderRideStatsTable = pgTable("rider_ride_stats", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  date: text("date").notNull(),
  ridesCompleted: integer("rides_completed").notNull().default(0),
  ridesReceived: integer("rides_received").notNull().default(0),
  pulledAt: timestamp("pulled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riderTargetOverridesTable = pgTable("rider_target_overrides", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  date: text("date").notNull(),
  overriddenBy: integer("overridden_by"),
  overriddenByName: text("overridden_by_name"),
  fromTarget: integer("from_target").notNull(),
  toTarget: integer("to_target").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiderDailyTarget = typeof riderDailyTargetsTable.$inferSelect;
export type InsertRiderDailyTarget = typeof riderDailyTargetsTable.$inferInsert;
export type RiderRideStat = typeof riderRideStatsTable.$inferSelect;
export type InsertRiderRideStat = typeof riderRideStatsTable.$inferInsert;
export type RiderTargetOverride = typeof riderTargetOverridesTable.$inferSelect;
export type InsertRiderTargetOverride = typeof riderTargetOverridesTable.$inferInsert;
