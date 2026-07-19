import { db, activityLogsTable } from "@workspace/db";

export async function logActivity(
  userId: number | null,
  userName: string,
  action: "created" | "updated" | "deleted" | "login" | "login_failed" | "logout",
  section: string,
  description: string,
): Promise<void> {
  try {
    await db.insert(activityLogsTable).values({ userId, userName, action, section, description });
  } catch (err) {
    console.error("[ActivityLog] Failed to write:", err);
  }
}
