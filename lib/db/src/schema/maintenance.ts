import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const maintenanceTable = pgTable("maintenance", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  maintenanceType: text("maintenance_type").notNull(),
  date: text("date").notNull(),
  cost: text("cost"),
  description: text("description"),
  nextServiceDate: text("next_service_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMaintenanceSchema = createInsertSchema(maintenanceTable).omit({ id: true, createdAt: true });
export type InsertMaintenance = z.infer<typeof insertMaintenanceSchema>;
export type Maintenance = typeof maintenanceTable.$inferSelect;

export const serviceHistoryTable = pgTable("service_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  serviceDate: text("service_date").notNull(),
  odometerAtService: integer("odometer_at_service").notNull(),
  notes: text("notes"),
  cost: text("cost"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceHistorySchema = createInsertSchema(serviceHistoryTable).omit({ id: true, createdAt: true });
export type InsertServiceHistory = z.infer<typeof insertServiceHistorySchema>;
export type ServiceHistory = typeof serviceHistoryTable.$inferSelect;
