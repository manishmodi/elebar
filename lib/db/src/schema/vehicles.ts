import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    vehicleNumber: text("vehicle_number").notNull(),
    plateNumber: text("plate_number").notNull(),
    vehicleType: text("vehicle_type"),
    brand: text("brand"),
    model: text("model"),
    manufactureYear: integer("manufacture_year"),
    color: text("color"),
    purchaseDate: text("purchase_date"),
    purchaseCost: text("purchase_cost"),
    batteryDetails: text("battery_details"),
    insuranceExpiry: text("insurance_expiry"),
    insuranceIssueDate: text("insurance_issue_date"),
    taxExpiry: text("tax_expiry"),
    serviceDueDate: text("service_due_date"),
    lastServiceDate: text("last_service_date"),
    lastServiceOdometer: integer("last_service_odometer"),
    servicingPayment: text("servicing_payment"),
    odometerReading: text("odometer_reading"),
    status: text("status").notNull().default("active"),
    locationBranch: text("location_branch"),
    gpsInstalled: text("gps_installed"),
    gpsNumber: text("gps_number"),
    gpsIdPassword: text("gps_id_password"),
    scooterBranding: text("scooter_branding"),
    yangoBrandingDate: text("yango_branding_date"),
    brandingPayment: text("branding_payment"),
    brandwrapExpireDate: text("brandwrap_expire_date"),
    bluebookIssueDate: text("bluebook_issue_date"),
    bluebookExpiryDate: text("bluebook_expiry_date"),
    inServicingSince: timestamp("in_servicing_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("vehicles_vehicle_number_unique").on(table.vehicleNumber)]
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
