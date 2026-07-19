import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { ridersTable } from "./riders";
import { vehiclesTable } from "./vehicles";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => expenseCategoriesTable.id),
  date: text("date").notNull(),
  amount: text("amount").notNull(),
  notes: text("notes"),
  riderId: integer("rider_id").references(() => ridersTable.id),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
