import { Router, type IRouter } from "express";
import { db, activityLogsTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();
const adminGuard = requireAdmin();

router.get("/activity-logs", adminGuard, async (req, res): Promise<void> => {
  const { section, action, dateFrom, dateTo } = req.query;

  const conditions = [];
  if (section && typeof section === "string") {
    conditions.push(eq(activityLogsTable.section, section));
  }
  if (action && typeof action === "string") {
    conditions.push(eq(activityLogsTable.action, action));
  }
  if (dateFrom && typeof dateFrom === "string") {
    conditions.push(gte(activityLogsTable.createdAt, new Date(dateFrom)));
  }
  if (dateTo && typeof dateTo === "string") {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(activityLogsTable.createdAt, end));
  }

  const rows = await db
    .select()
    .from(activityLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(1000);

  res.json(rows);
});

export default router;
