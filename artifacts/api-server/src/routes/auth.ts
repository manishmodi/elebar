import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, userPermissionsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { logActivity } from "../lib/activity-logger";

const ALL_SECTIONS = [
  "dashboard", "daily-logs", "vehicles", "riders", "salary",
  "assignments", "attendance", "maintenance", "financials", "reports", "expenses",
  "cash-collection", "performance",
];

const DEFAULT_PERM = { canView: false, canCreate: false, canEdit: false, canDelete: false };

async function buildPermissionsMap(userId: number) {
  const permissions = await db
    .select()
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, userId));

  const permissionsMap: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {};
  ALL_SECTIONS.forEach((section) => {
    const p = permissions.find((row) => row.section === section);
    permissionsMap[section] = p
      ? { canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete }
      : { ...DEFAULT_PERM };
  });

  return permissionsMap;
}

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "Account is deactivated. Contact your administrator." });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    logActivity(user.id, user.fullName, "login_failed", "auth", `Failed login attempt for ${user.email}`);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const permissionsMap = await buildPermissionsMap(user.id);

  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.userName = user.fullName;

  logActivity(user.id, user.fullName, "login", "auth", `User logged in: ${user.email}`);

  res.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
    },
    permissions: permissionsMap,
  });
});

router.post("/auth/logout", (req, res): void => {
  const userId = req.session.userId ?? null;
  const userName = req.session.userName ?? "Unknown";
  const userEmail = req.session.userEmail ?? "";
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    logActivity(userId, userName, "logout", "auth", `User logged out: ${userEmail}`);
    res.clearCookie("efms.sid");
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Account no longer active" });
    return;
  }

  const permissionsMap = await buildPermissionsMap(user.id);

  res.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
    },
    permissions: permissionsMap,
  });
});

export default router;
