import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { ridersTable } from "./riders";

export const salaryAdvancesTable = pgTable("salary_advances", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  date: text("date").notNull(),
  amount: text("amount").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  salaryPaymentId: integer("salary_payment_id").references(() => salaryPaymentsTable.id),
});

export const salaryPaymentsTable = pgTable("salary_payments", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  periodFrom: text("period_from").notNull(),
  periodTo: text("period_to").notNull(),
  daysWorked: integer("days_worked").notNull().default(0),
  timesTargetMissed: integer("times_target_missed").notNull().default(0),
  baseSalary: text("base_salary").notNull(),
  totalAllowances: text("total_allowances").notNull().default("0"),
  totalAdvances: text("total_advances").notNull().default("0"),
  totalCashVariance: text("total_cash_variance").notNull().default("0"),
  finalSalary: text("final_salary").notNull(),
  salaryProcessed: text("salary_processed"),
  salaryDifference: text("salary_difference"),
  // Which formula produced finalSalary: 'legacy' (monthly rate × days) or
  // 'vpe' (sum of locked Variable-Pay-Engine day records). Audit marker only.
  payModel: text("pay_model").notNull().default("legacy"),
  flagged: boolean("flagged").notNull().default(false),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  processedBy: text("processed_by"),
  notes: text("notes"),
});

export type SalaryAdvance = typeof salaryAdvancesTable.$inferSelect;
export type InsertSalaryAdvance = typeof salaryAdvancesTable.$inferInsert;
export type SalaryPayment = typeof salaryPaymentsTable.$inferSelect;
export type InsertSalaryPayment = typeof salaryPaymentsTable.$inferInsert;
