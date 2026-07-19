import { pgTable, serial, integer, text, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userPermissionsTable = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  section: text("section").notNull(),
  canView: boolean("can_view").notNull().default(false),
  canCreate: boolean("can_create").notNull().default(false),
  canEdit: boolean("can_edit").notNull().default(false),
  canDelete: boolean("can_delete").notNull().default(false),
}, (table) => [
  unique("user_section_unique").on(table.userId, table.section),
]);

export type UserPermission = typeof userPermissionsTable.$inferSelect;
export type InsertUserPermission = typeof userPermissionsTable.$inferInsert;
