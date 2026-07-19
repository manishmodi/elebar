import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { ridersTable } from "./riders";
import { usersTable } from "./users";

export const cashCollectionsTable = pgTable("cash_collections", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  englishDate: text("english_date").notNull(),
  nepaliDate: text("nepali_date"),

  // Denomination breakdown (number of notes)
  denom1000: integer("denom_1000").notNull().default(0),
  denom500: integer("denom_500").notNull().default(0),
  denom100: integer("denom_100").notNull().default(0),
  denom50: integer("denom_50").notNull().default(0),
  denom20: integer("denom_20").notNull().default(0),
  denom10: integer("denom_10").notNull().default(0),

  // Totals
  cashTotal: text("cash_total").notNull().default("0"),
  walletAmount: text("wallet_amount").notNull().default("0"),
  grandTotal: text("grand_total").notNull().default("0"),

  note: text("note"),

  // Submission audit
  submittedBy: integer("submitted_by").references(() => usersTable.id),
  submittedByName: text("submitted_by_name"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

  // Approval workflow
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),
});

export type CashCollection = typeof cashCollectionsTable.$inferSelect;
export type InsertCashCollection = typeof cashCollectionsTable.$inferInsert;
