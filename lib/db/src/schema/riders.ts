import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ridersTable = pgTable("riders", {
  id: serial("id").primaryKey(),
  // KYC
  kycSubmissionDate: text("kyc_submission_date"),
  // Personal Information
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  secondaryPhone: text("secondary_phone"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  maritalStatus: text("marital_status"),
  bloodGroup: text("blood_group"),
  permanentAddress: text("permanent_address"),
  temporaryAddress: text("temporary_address"),
  address: text("address"),
  email: text("email"),
  emergencyContact: text("emergency_contact"),
  // License & Documents
  citizenshipNumber: text("citizenship_number"),
  citizenshipIssueDate: text("citizenship_issue_date"),
  citizenshipIssueDistrict: text("citizenship_issue_district"),
  citizenshipImageUrl: text("citizenship_image_url"),
  nidNumber: text("nid_number"),
  nidIssueDate: text("nid_issue_date"),
  nidIssueDistrict: text("nid_issue_district"),
  licenseNumber: text("license_number"),
  licenseExpiryDate: text("license_expiry_date"),
  licenseIssueDate: text("license_issue_date"),
  licenseIssueDistrict: text("license_issue_district"),
  licenseType: text("license_type"),
  licenseImageUrl: text("license_image_url"),
  drivingExperience: text("driving_experience"),
  // Family Details
  fatherName: text("father_name"),
  fatherPhone: text("father_phone"),
  motherName: text("mother_name"),
  motherPhone: text("mother_phone"),
  spouseName: text("spouse_name"),
  spousePhone: text("spouse_phone"),
  grandfatherName: text("grandfather_name"),
  grandmotherName: text("grandmother_name"),
  familyAddress: text("family_address"),
  // Emergency Contact
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  relationshipProofUrl: text("relationship_proof_url"),
  // Employment
  joiningDate: text("joining_date"),
  employmentType: text("employment_type").default("full_time"),
  salaryStructure: text("salary_structure"),
  monthlySalary: text("monthly_salary"),
  dailyRideTarget: integer("daily_ride_target"),
  assignedSupervisor: text("assigned_supervisor"),
  securityDeposit: text("security_deposit"),
  bankAccountDetails: text("bank_account_details"),
  status: text("status").notNull().default("active"),
  yangoDriverId: text("yango_driver_id"),
  // Rider-app fleet pilot: only ticked riders see the Fleet tab in the Riders
  // Club app and get Variable-Pay-Engine daily pay. Admin-controlled rollout.
  fleetPilot: boolean("fleet_pilot").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRiderSchema = createInsertSchema(ridersTable).omit({ id: true, createdAt: true });
export type InsertRider = z.infer<typeof insertRiderSchema>;
export type Rider = typeof ridersTable.$inferSelect;
