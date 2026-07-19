import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, userPermissionsTable, type InsertUser } from "@workspace/db";
import bcrypt from "bcryptjs";
import { requireAdmin, parseParamId } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const SECTIONS = [
  "dashboard",
  "daily-logs",
  "vehicles",
  "riders",
  "salary",
  "assignments",
  "attendance",
  "maintenance",
  "financials",
  "reports",
  "expenses",
  "cash-collection",
  "performance",
];

const router: IRouter = Router();

const adminGuard = requireAdmin();

router.get("/users", adminGuard, async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable);

  const allPerms = await db.select().from(userPermissionsTable);

  const result = users.map((u) => {
    const perms: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {};
    allPerms
      .filter((p) => p.userId === u.id)
      .forEach((p) => {
        perms[p.section] = {
          canView: p.canView,
          canCreate: p.canCreate,
          canEdit: p.canEdit,
          canDelete: p.canDelete,
        };
      });
    return { ...u, permissions: perms };
  });

  res.json(result);
});

router.post("/users", adminGuard, async (req, res): Promise<void> => {
  const { fullName, email, password, permissions } = req.body;

  if (!fullName || !email || !password) {
    res.status(400).json({ error: "Full name, email, and password are required" });
    return;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (existing.length > 0) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      fullName,
      email: email.toLowerCase().trim(),
      passwordHash,
    })
    .returning();

  if (permissions && typeof permissions === "object") {
    const permRows = SECTIONS.map((section) => ({
      userId: user.id,
      section,
      canView: Boolean(permissions[section]?.canView),
      canCreate: Boolean(permissions[section]?.canCreate),
      canEdit: Boolean(permissions[section]?.canEdit),
      canDelete: Boolean(permissions[section]?.canDelete),
    }));
    await db.insert(userPermissionsTable).values(permRows);
  }

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "users", `Created user account: ${user.fullName} (${user.email})`);
  res.status(201).json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    isActive: user.isActive,
  });
});

router.put("/users/:id", adminGuard, async (req, res): Promise<void> => {
  const userId = parseParamId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { fullName, email, password, isActive, permissions } = req.body;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updates: Partial<Pick<InsertUser, "fullName" | "email" | "passwordHash" | "isActive">> = {};
  if (fullName !== undefined) updates.fullName = String(fullName);
  if (email !== undefined) updates.email = String(email).toLowerCase().trim();
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (password) updates.passwordHash = await bcrypt.hash(String(password), 10);

  if (Object.keys(updates).length > 0) {
    await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId));
  }

  if (permissions && typeof permissions === "object") {
    await db.delete(userPermissionsTable).where(eq(userPermissionsTable.userId, userId));

    const permRows = SECTIONS.map((section) => ({
      userId,
      section,
      canView: Boolean(permissions[section]?.canView),
      canCreate: Boolean(permissions[section]?.canCreate),
      canEdit: Boolean(permissions[section]?.canEdit),
      canDelete: Boolean(permissions[section]?.canDelete),
    }));
    await db.insert(userPermissionsTable).values(permRows);
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "users", `Updated user account: ${user?.fullName ?? `#${userId}`}`);
  res.json(user);
});

router.get("/users/:id/permissions", adminGuard, async (req, res): Promise<void> => {
  const userId = parseParamId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const perms = await db
    .select()
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, userId));

  const permissionsMap: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {};
  SECTIONS.forEach((section) => {
    const p = perms.find((row) => row.section === section);
    permissionsMap[section] = p
      ? { canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete }
      : { canView: false, canCreate: false, canEdit: false, canDelete: false };
  });

  res.json(permissionsMap);
});

router.put("/users/:id/permissions", adminGuard, async (req, res): Promise<void> => {
  const userId = parseParamId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const permissions = req.body;
  if (!permissions || typeof permissions !== "object") {
    res.status(400).json({ error: "Permissions object is required" });
    return;
  }

  await db.delete(userPermissionsTable).where(eq(userPermissionsTable.userId, userId));

  const permRows = SECTIONS.map((section) => ({
    userId,
    section,
    canView: Boolean(permissions[section]?.canView),
    canCreate: Boolean(permissions[section]?.canCreate),
    canEdit: Boolean(permissions[section]?.canEdit),
    canDelete: Boolean(permissions[section]?.canDelete),
  }));
  await db.insert(userPermissionsTable).values(permRows);

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "users", `Updated permissions for user: ${user.fullName}`);

  const result: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {};
  permRows.forEach((r) => {
    result[r.section] = { canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete };
  });

  res.json(result);
});

router.delete("/users/:id", adminGuard, async (req, res): Promise<void> => {
  const userId = parseParamId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  if (req.session.userId === userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "users", `Deleted user account: ${deleted.fullName} (${deleted.email})`);
  res.json({ message: "User deleted successfully" });
});

export default router;
