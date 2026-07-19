import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { objectStorage, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

function pipeStored(
  res: Response,
  stored: { stream: NodeJS.ReadableStream; contentType: string; size?: number; cacheControl: string },
): void {
  res.setHeader("Content-Type", stored.contentType);
  res.setHeader("Cache-Control", stored.cacheControl);
  if (stored.size != null) {
    res.setHeader("Content-Length", String(stored.size));
  }
  stored.stream.pipe(res);
}

/**
 * POST /storage/upload?name=<filename>
 *
 * Server-proxied upload: the browser sends the raw file bytes as the request body
 * (Content-Type = the file's mime type). The API stores it via the active storage
 * driver and returns its objectPath. Auth required — only staff upload.
 */
router.post(
  "/storage/upload",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "Empty or missing file body" });
        return;
      }

      const contentType = req.headers["content-type"] || "application/octet-stream";
      const originalName = typeof req.query.name === "string" ? req.query.name : undefined;

      const { objectPath } = await objectStorage.upload({ body, contentType, originalName });
      res.json({ objectPath });
    } catch (error) {
      console.error({ err: error }, "Error uploading object");
      res.status(500).json({ error: "Failed to upload file" });
    }
  },
);

/**
 * GET /storage/public-objects/*  — world-readable assets (no auth).
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const stored = await objectStorage.getPublic(filePath);
    pipeStored(res, stored);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    console.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*  — private uploads (KYC docs etc.). Auth required.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const stored = await objectStorage.getByObjectPath(`/objects/${wildcardPath}`);
    pipeStored(res, stored);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
