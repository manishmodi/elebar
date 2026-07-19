import { createInsertSchema } from "drizzle-zod";
import { ridersTable } from "./schema/riders";

// Validation derived from the ACTUAL riders table, so every column (all KYC
// fields, incl. the image URLs) is accepted on create/update. The hand-written
// OpenAPI schema in api-zod lists only ~17 of the ~50 columns, and Zod silently
// strips the rest — which is why uploaded KYC image paths never got persisted.
export const riderInsertSchema = createInsertSchema(ridersTable).omit({
  id: true,
  createdAt: true,
});

export const riderUpdateSchema = riderInsertSchema.partial();
