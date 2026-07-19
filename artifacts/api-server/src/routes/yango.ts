import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ridersTable } from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { isConfigured } from "../lib/yango-client.js";
import { syncForDate, previewForDate, persistFromPreview, getYesterdayNepal } from "../lib/yango-sync.js";
import { startPreviewJob, getPreviewJob } from "../lib/yango-jobs.js";
import { searchDrivers, getAllDrivers, getCacheState, forceRefresh } from "../lib/yango-driver-cache.js";

const router: IRouter = Router();

router.get("/yango/status", requirePermission("daily-logs", "canView"), (_req, res): void => {
  res.json({
    configured: isConfigured(),
    lastSync: null,
    nextSyncAt: null,
  });
});

router.get("/yango/drivers", requirePermission("riders", "canEdit"), (req, res): void => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Yango API credentials not configured" });
    return;
  }
  const cache = getCacheState();
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const drivers = q ? searchDrivers(q) : getAllDrivers();
  res.json({
    drivers,
    cache: {
      ready: cache.ready,
      loading: cache.loading,
      total: cache.total,
      progress: cache.progress,
      loadedAt: cache.loadedAt,
      error: cache.error,
    },
  });
});

router.post("/yango/drivers/refresh", requirePermission("riders", "canEdit"), async (_req, res): Promise<void> => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Yango API credentials not configured" });
    return;
  }
  try {
    await forceRefresh();
    const cache = getCacheState();
    res.json({ success: true, total: cache.total });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to refresh" });
  }
});

router.put("/yango/riders/:id/link", requirePermission("riders", "canEdit"), async (req, res): Promise<void> => {
  const riderId = parseInt(req.params.id as string, 10);
  if (isNaN(riderId)) { res.status(400).json({ error: "Invalid rider ID" }); return; }

  const { yangoDriverId } = req.body;
  if (!yangoDriverId || typeof yangoDriverId !== "string") {
    res.status(400).json({ error: "yangoDriverId is required" });
    return;
  }

  const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.id, riderId));
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }

  await db.update(ridersTable).set({ yangoDriverId }).where(eq(ridersTable.id, riderId));
  res.json({ success: true, riderId, yangoDriverId });
});

router.delete("/yango/riders/:id/link", requirePermission("riders", "canEdit"), async (req, res): Promise<void> => {
  const riderId = parseInt(req.params.id as string, 10);
  if (isNaN(riderId)) { res.status(400).json({ error: "Invalid rider ID" }); return; }

  const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.id, riderId));
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }

  await db.update(ridersTable).set({ yangoDriverId: null }).where(eq(ridersTable.id, riderId));
  res.json({ success: true, riderId, yangoDriverId: null });
});

router.post("/yango/sync/preview", requirePermission("daily-logs", "canCreate"), async (req, res): Promise<void> => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Yango API credentials not configured" });
    return;
  }
  const date: string = req.body?.date ?? getYesterdayNepal();
  try {
    const result = await previewForDate(date);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Preview failed" });
  }
});

// Background preview: kick off the (potentially multi-minute) Yango fetch and return a
// job id immediately, so the request never hits the ~60s proxy timeout. The UI polls
// /yango/sync/preview/status/:id for progress and the final result.
router.post("/yango/sync/preview/start", requirePermission("daily-logs", "canCreate"), (req, res): void => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Yango API credentials not configured" });
    return;
  }
  const date: string = req.body?.date ?? getYesterdayNepal();
  // Optional: scope the sync to specific riders. Absent/empty => all linked riders.
  const riderIds = Array.isArray(req.body?.riderIds)
    ? req.body.riderIds.filter((x: unknown): x is number => typeof x === "number" && Number.isInteger(x))
    : null;
  const { job, conflict } = startPreviewJob(date, riderIds);
  if (conflict) {
    res.status(409).json({ error: `A sync for ${job.date} is already running. Please wait for it to finish, then try again.` });
    return;
  }
  res.json({ id: job.id, date: job.date, status: job.status, total: job.total, completed: job.completed });
});

router.get("/yango/sync/preview/status/:id", requirePermission("daily-logs", "canCreate"), (req, res): void => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getPreviewJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Preview job not found or expired. Please start a new sync." });
    return;
  }
  res.json({
    id: job.id,
    date: job.date,
    status: job.status,
    total: job.total,
    completed: job.completed,
    ...(job.status === "done" ? { result: job.result } : {}),
    ...(job.status === "error" ? { error: job.error } : {}),
  });
});

router.post("/yango/sync", requirePermission("daily-logs", "canCreate"), async (req, res): Promise<void> => {
  const date: string = req.body?.date ?? getYesterdayNepal();
  const previewRiders = Array.isArray(req.body?.riders) ? req.body.riders : null;

  try {
    // Fast path: caller (the UI) just ran preview seconds ago and is sending those
    // computed stats — persist directly without re-hitting the rate-limited Yango API.
    if (previewRiders) {
      const result = await persistFromPreview(date, previewRiders);
      res.json(result);
      return;
    }

    // Slow path: no preview supplied (e.g. cron) — re-fetch from Yango.
    if (!isConfigured()) {
      res.status(503).json({ error: "Yango API credentials not configured" });
      return;
    }
    const result = await syncForDate(date);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Sync failed" });
  }
});

export default router;
