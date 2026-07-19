import { Readable } from "stream";
import { randomUUID } from "crypto";
import { extname } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Object storage for the Elebhar FMS.
 *
 * Replaces the original Replit Object Storage (GCS-via-sidecar) with a pluggable
 * driver model so the same upload/serve flow works in every environment:
 *   - dev / self-hosted:  S3-compatible (MinIO container) — STORAGE_DRIVER=s3
 *   - production:         Vercel Blob                      — STORAGE_DRIVER=vercel-blob (Step 4)
 *
 * Uploads are server-proxied: the browser POSTs the file to the API, which stores
 * it via the active driver. This keeps a single uniform flow across drivers (Vercel
 * Blob has no S3-style presigned PUT) and avoids exposing storage credentials or
 * MinIO's internal hostname to the browser.
 *
 * objectPath convention (stored on records, e.g. riders.citizenship_image_url):
 *   "/objects/uploads/<uuid><ext>"  -> served via GET /api/storage/objects/uploads/<uuid><ext>
 */

const DRIVER = (process.env.STORAGE_DRIVER || "s3").toLowerCase();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface StoredObject {
  stream: Readable;
  contentType: string;
  size?: number;
  cacheControl: string;
}

export interface UploadInput {
  body: Buffer;
  contentType: string;
  originalName?: string;
  /** "private" (default) is served behind auth; "public" is world-readable. */
  visibility?: "private" | "public";
}

interface StorageDriver {
  /** Store bytes and return the canonical key (e.g. "uploads/<uuid>.png"). */
  put(key: string, body: Buffer, contentType: string, visibility: "private" | "public"): Promise<void>;
  /** Stream an object back. Throws ObjectNotFoundError when missing. */
  get(key: string, visibility: "private" | "public", cacheControl: string): Promise<StoredObject>;
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 / MinIO driver
// ─────────────────────────────────────────────────────────────────────────────

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _s3;
}

function bucketFor(visibility: "private" | "public"): string {
  return visibility === "public"
    ? process.env.S3_PUBLIC_BUCKET || "elebhar-public"
    : process.env.S3_PRIVATE_BUCKET || "elebhar-private";
}

const s3Driver: StorageDriver = {
  async put(key, body, contentType, visibility) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucketFor(visibility),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },

  async get(key, visibility, cacheControl) {
    try {
      const out = await s3().send(
        new GetObjectCommand({ Bucket: bucketFor(visibility), Key: key }),
      );
      if (!out.Body) {
        throw new ObjectNotFoundError();
      }
      return {
        stream: out.Body as Readable,
        contentType: out.ContentType || "application/octet-stream",
        size: out.ContentLength,
        cacheControl,
      };
    } catch (err) {
      if (isS3NotFound(err)) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }
  },
};

function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel Blob driver — implemented at Step 4 (prod wiring), tested against a real
// Blob store. Selected when STORAGE_DRIVER=vercel-blob (BLOB_READ_WRITE_TOKEN).
// ─────────────────────────────────────────────────────────────────────────────

// @vercel/blob is lazy-imported so it never loads in the S3/dev path.
const vercelBlobDriver: StorageDriver = {
  async put(key, body, contentType) {
    const { put } = await import("@vercel/blob");
    await put(key, body, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  },

  async get(key, _visibility, cacheControl) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({
      prefix: key,
      limit: 1,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    const blob = blobs.find((b) => b.pathname === key) ?? blobs[0];
    if (!blob) {
      throw new ObjectNotFoundError();
    }
    // Objects are served through this authed API route, not the blob URL directly.
    const resp = await fetch(blob.url);
    if (!resp.ok || !resp.body) {
      throw new ObjectNotFoundError();
    }
    return {
      stream: Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0]),
      contentType: resp.headers.get("content-type") || "application/octet-stream",
      size: Number(resp.headers.get("content-length")) || undefined,
      cacheControl,
    };
  },
};

function driver(): StorageDriver {
  return DRIVER === "vercel-blob" ? vercelBlobDriver : s3Driver;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API used by the storage routes
// ─────────────────────────────────────────────────────────────────────────────

export const objectStorage = {
  /** Store an uploaded file and return its objectPath ("/objects/uploads/<id>"). */
  async upload({ body, contentType, originalName, visibility = "private" }: UploadInput): Promise<{ objectPath: string }> {
    const ext = originalName ? extname(originalName).slice(0, 10) : "";
    const key = `uploads/${randomUUID()}${ext}`;
    await driver().put(key, body, contentType, visibility);
    return { objectPath: `/objects/${key}` };
  },

  /** Serve a private object referenced by its objectPath ("/objects/<key>"). */
  async getByObjectPath(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice("/objects/".length);
    if (!key) {
      throw new ObjectNotFoundError();
    }
    return driver().get(key, "private", "private, max-age=3600");
  },

  /** Serve a public object by its relative path. */
  async getPublic(filePath: string): Promise<StoredObject> {
    const key = filePath.replace(/^\/+/, "");
    if (!key) {
      throw new ObjectNotFoundError();
    }
    return driver().get(key, "public", "public, max-age=3600");
  },
};
