import { Request, Response, NextFunction } from "express";
import { db, usersTable, userPermissionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: number;
    userEmail: string;
    userName: string;
  }
}

async function verifyActiveUser(req: Request, res: Response): Promise<boolean> {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }

  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Account deactivated" });
    return false;
  }

  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ok = await verifyActiveUser(req, res);
    if (ok) next();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

type PermissionAction = "canView" | "canCreate" | "canEdit" | "canDelete";

export function requirePermission(section: string, action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const active = await verifyActiveUser(req, res);
    if (!active) return;

    const [perm] = await db
      .select()
      .from(userPermissionsTable)
      .where(
        and(
          eq(userPermissionsTable.userId, req.session.userId!),
          eq(userPermissionsTable.section, section)
        )
      );

    if (!perm || !perm[action]) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

const ADMIN_SECTIONS = [
  "dashboard", "daily-logs", "vehicles", "riders",
  "assignments", "attendance", "maintenance", "financials", "reports", "salary",
  "expenses", "cash-collection", "performance",
];

/** True when the user has full CRUD on every admin section (the app's definition of "admin"). */
export async function isAdminUser(userId: number): Promise<boolean> {
  const perms = await db
    .select()
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, userId));
  return ADMIN_SECTIONS.every((section) => {
    const perm = perms.find((p) => p.section === section);
    return !!(perm && perm.canView && perm.canCreate && perm.canEdit && perm.canDelete);
  });
}

export function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const active = await verifyActiveUser(req, res);
    if (!active) return;

    const hasFullAccess = await isAdminUser(req.session.userId!);

    if (!hasFullAccess) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    next();
  };
}

export function parseParamId(raw: string | string[] | undefined): number | null {
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return null;
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}
