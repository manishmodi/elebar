import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ridersTable } from "./riders";
import { vehiclesTable } from "./vehicles";

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id").notNull().references(() => ridersTable.id),
  date: text("date").notNull(),
  nepaliDate: text("nepali_date"),
  type: text("type").notNull().default("present"),
  remarks: text("remarks"),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  batteryOut: integer("battery_out"),
  batteryIn: integer("battery_in"),
  scooterOut: text("scooter_out"),
  scooterIn: text("scooter_in"),
  riderTimeIn: text("rider_time_in"),
  riderTimeOut: text("rider_time_out"),
  distanceIn: text("distance_in"),
  distanceOut: text("distance_out"),
  vehicleOverrideReason: text("vehicle_override_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
