import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { ridersTable } from "./riders";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";

// Rider-app fleet operations (check-out / exchange / check-in) + the Variable
// Pay Engine. All additive: the canonical attendance / cash_collections rows
// are still the system of record — handovers STAGE rider submissions until a
// guard verifies, and pay_records are derived from locked days.
// Money columns are text to match the codebase-wide convention.

// One row per rider action awaiting (or past) guard verification. `payload`
// holds the kind-specific fields (odometer, battery, goalTier, cash declared,
// photo objectPaths; for exchanges: closing/opening leg objects).
export const fleetHandoversTable = pgTable(
  "fleet_handovers",
  {
    id: serial("id").primaryKey(),
    riderId: integer("rider_id").notNull().references(() => ridersTable.id),
    englishDate: text("english_date").notNull(),
    kind: text("kind").notNull(), // checkout | exchange | checkin
    status: text("status").notNull().default("pending"), // pending | verified | rejected
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
    cashExpected: text("cash_expected"),
    cashVariance: text("cash_variance"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedBy: integer("verified_by").references(() => usersTable.id),
    verifiedByName: text("verified_by_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
  },
  (t) => [
    uniqueIndex("fleet_handovers_idempotency_key_unique").on(t.idempotencyKey),
    index("fleet_handovers_rider_date_idx").on(t.riderId, t.englishDate),
    index("fleet_handovers_status_idx").on(t.status),
  ],
);

// Versioned pay parameters. The engine always resolves a parameter as the row
// with the latest effective_from <= the day being computed, so historical days
// recompute against the rules that were active on that day.
export const payConfigTable = pgTable(
  "pay_config",
  {
    id: serial("id").primaryKey(),
    parameter: text("parameter").notNull(),
    value: text("value").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pay_config_parameter_effective_unique").on(t.parameter, t.effectiveFrom)],
);

// One row per pilot rider per day, written when the day locks (cash approved).
export const payRecordsTable = pgTable(
  "pay_records",
  {
    id: serial("id").primaryKey(),
    riderId: integer("rider_id").notNull().references(() => ridersTable.id),
    englishDate: text("english_date").notNull(),
    base: text("base").notNull().default("0"),
    commission: text("commission").notNull().default("0"),
    prize: text("prize").notNull().default("0"),
    growth: text("growth").notNull().default("0"),
    dailyPay: text("daily_pay").notNull().default("0"),
    gatesApplied: jsonb("gates_applied"),
    flags: jsonb("flags"),
    status: text("status").notNull().default("computed"), // computed | locked
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("pay_records_rider_date_unique").on(t.riderId, t.englishDate)],
);

export const streaksTable = pgTable(
  "streaks",
  {
    id: serial("id").primaryKey(),
    riderId: integer("rider_id").notNull().references(() => ridersTable.id),
    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    lastQualifyingDate: text("last_qualifying_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("streaks_rider_unique").on(t.riderId)],
);

export type FleetHandover = typeof fleetHandoversTable.$inferSelect;
export type PayConfig = typeof payConfigTable.$inferSelect;
export type PayRecord = typeof payRecordsTable.$inferSelect;
export type Streak = typeof streaksTable.$inferSelect;
