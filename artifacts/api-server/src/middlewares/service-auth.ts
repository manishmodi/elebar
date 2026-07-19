import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, ridersTable, type Rider } from "@workspace/db";

/**
 * Service-to-service auth for the /api/fleet/v1 namespace.
 *
 * The caller is the Riders Club backend (never a browser / rider device):
 * it authenticates with a shared bearer token (FLEET_SERVICE_TOKEN env) and
 * asserts WHICH rider it has already authenticated via X-Rider-Yango-Id.
 * This is deliberately separate from the session/RBAC middleware — service
 * calls have no session, and session routes must never accept this token.
 */

/** Request carrying the rider resolved from X-Rider-Yango-Id (rider-scoped routes). */
export interface FleetRequest extends Request {
  fleetRider?: Rider;
}

function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireServiceAuth(opts: { riderScoped: boolean }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const expected = process.env.FLEET_SERVICE_TOKEN;
    if (!expected) {
      res.status(503).json({ error: "Fleet API not configured" });
      return;
    }

    const header = req.headers.authorization ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!supplied || !tokenMatches(supplied, expected)) {
      res.status(401).json({ error: "Invalid service credentials" });
      return;
    }

    if (opts.riderScoped) {
      const yangoId = req.header("x-rider-yango-id")?.trim();
      if (!yangoId) {
        res.status(400).json({ error: "X-Rider-Yango-Id header required" });
        return;
      }
      const [rider] = await db
        .select()
        .from(ridersTable)
        .where(and(eq(ridersTable.yangoDriverId, yangoId), eq(ridersTable.status, "active")));
      if (!rider || !rider.fleetPilot) {
        res.status(403).json({ error: "Rider is not an active fleet pilot" });
        return;
      }
      (req as FleetRequest).fleetRider = rider;
    }

    next();
  };
}
