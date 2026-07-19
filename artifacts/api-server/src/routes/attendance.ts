import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, attendanceTable, ridersTable, vehiclesTable, fleetHandoversTable } from "@workspace/db";
import {
  ListAttendanceQueryParams,
  CreateAttendanceBody,
  UpdateAttendanceParams,
  UpdateAttendanceBody,
  DeleteAttendanceParams,
} from "@workspace/api-zod";
import { requirePermission, isAdminUser } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";
import { computeAndLockPay } from "../lib/pay-engine";

const router: IRouter = Router();

// Guard-entry handling. Odometer readings feed servicing's km derivation, which
// requires plain positive integers (^[1-9][0-9]*$) — but guards' real habits
// include decimals (62 historical rows) and "0" meaning "no reading" (300+
// rows), so we NORMALIZE instead of rejecting: decimals round to the nearest
// whole number, and 0 is stored as empty (exactly what it always meant).
// Battery stays validated 0–100. Deliberately NOT enforcing out >= in: a
// mid-day scooter exchange legitimately puts two machines' readings on one row.
function normalizeGuardFields(data: {
  batteryOut?: number | null;
  batteryIn?: number | null;
  distanceIn?: string | null;
  distanceOut?: string | null;
}): string | null {
  for (const [label, v] of [["Battery % Out", data.batteryOut], ["Battery % In", data.batteryIn]] as const) {
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 100)) {
      return `${label} must be a whole number between 0 and 100.`;
    }
  }
  for (const key of ["distanceIn", "distanceOut"] as const) {
    const raw = data[key];
    if (raw == null || String(raw).trim() === "") continue;
    const cleaned = String(raw).trim().replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) {
      const label = key === "distanceIn" ? "Odometer Out" : "Odometer In";
      return `${label} must be a number (e.g. 12282).`;
    }
    const n = Math.round(parseFloat(cleaned));
    // 0 = the guards' long-standing "no reading" convention → store empty so
    // day-km and servicing skip it, same as a blank.
    (data as Record<string, unknown>)[key] = n === 0 ? null : String(n);
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  // drizzle may wrap the pg DatabaseError (code lives on .cause), so check both.
  let e = err as { code?: string; cause?: unknown } | null;
  for (let depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    if (e.code === "23505") return true;
    e = e.cause as typeof e;
  }
  return false;
}

// The guard-verified handshake fields. Once the guard verifies End Shift, a
// pilot rider's day is CLOSED: these fields lock for regular attendance
// editors and only an admin may change them (staff corrections stay allowed
// while the day is still open). Admin post-lock edits recompute the day's pay.
const GUARD_LOCKED_FIELDS = [
  "riderTimeIn", "riderTimeOut", "scooterOut", "scooterIn",
  "batteryOut", "batteryIn", "distanceIn", "distanceOut",
] as const;

async function isClosedPilotDay(riderId: number, date: string): Promise<boolean> {
  const [rider] = await db
    .select({ pilot: ridersTable.fleetPilot })
    .from(ridersTable)
    .where(eq(ridersTable.id, riderId));
  if (!rider?.pilot) return false;
  const [checkin] = await db
    .select({ id: fleetHandoversTable.id })
    .from(fleetHandoversTable)
    .where(
      and(
        eq(fleetHandoversTable.riderId, riderId),
        eq(fleetHandoversTable.englishDate, date),
        eq(fleetHandoversTable.kind, "checkin"),
        eq(fleetHandoversTable.status, "verified"),
      ),
    );
  return !!checkin;
}

const attendanceSelect = {
  id: attendanceTable.id,
  riderId: attendanceTable.riderId,
  riderName: ridersTable.fullName,
  date: attendanceTable.date,
  nepaliDate: attendanceTable.nepaliDate,
  type: attendanceTable.type,
  remarks: attendanceTable.remarks,
  vehicleId: attendanceTable.vehicleId,
  vehiclePlate: vehiclesTable.plateNumber,
  batteryOut: attendanceTable.batteryOut,
  batteryIn: attendanceTable.batteryIn,
  scooterOut: attendanceTable.scooterOut,
  scooterIn: attendanceTable.scooterIn,
  riderTimeIn: attendanceTable.riderTimeIn,
  riderTimeOut: attendanceTable.riderTimeOut,
  distanceIn: attendanceTable.distanceIn,
  distanceOut: attendanceTable.distanceOut,
  vehicleOverrideReason: attendanceTable.vehicleOverrideReason,
  createdAt: attendanceTable.createdAt,
};

router.get("/attendance", requirePermission("attendance", "canView"), async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.riderId) {
    conditions.push(eq(attendanceTable.riderId, query.data.riderId));
  }
  if (query.success && query.data.vehicleId) {
    conditions.push(eq(attendanceTable.vehicleId, query.data.vehicleId));
  }
  if (query.success && query.data.startDate) {
    conditions.push(gte(attendanceTable.date, String(query.data.startDate)));
  }
  if (query.success && query.data.endDate) {
    conditions.push(lte(attendanceTable.date, String(query.data.endDate)));
  }

  const rows = await db
    .select(attendanceSelect)
    .from(attendanceTable)
    .leftJoin(ridersTable, eq(attendanceTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(attendanceTable.vehicleId, vehiclesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(attendanceTable.id);

  res.json(rows);
});

router.post("/attendance", requirePermission("attendance", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invalid = normalizeGuardFields(parsed.data);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  let record;
  try {
    [record] = await db.insert(attendanceTable).values(parsed.data).returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "An attendance record already exists for this rider on this date — edit that record instead." });
      return;
    }
    throw err;
  }

  const [row] = await db
    .select(attendanceSelect)
    .from(attendanceTable)
    .leftJoin(ridersTable, eq(attendanceTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(attendanceTable.vehicleId, vehiclesTable.id))
    .where(eq(attendanceTable.id, record.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "attendance", `Marked attendance for ${row?.riderName ?? `rider #${record.riderId}`} on ${record.date} as ${record.type}`);
  res.status(201).json(row);
});

router.put("/attendance/:id", requirePermission("attendance", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invalid = normalizeGuardFields(parsed.data);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  const [existing] = await db.select().from(attendanceTable).where(eq(attendanceTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }

  // Shift-clock lock: after the guard verifies End Shift, the guard-log fields
  // are frozen for regular editors — admin only, with an automatic pay
  // recompute (hours/odometer feed the Pay Engine and servicing).
  const body = parsed.data as Record<string, unknown>;
  const touchesLocked = GUARD_LOCKED_FIELDS.some(
    (f) => f in body && body[f] != null && String(body[f]) !== String((existing as Record<string, unknown>)[f] ?? ""),
  );
  let closedDay = false;
  if (touchesLocked) {
    closedDay = await isClosedPilotDay(existing.riderId, existing.date);
    if (closedDay && !(await isAdminUser(req.session.userId!))) {
      res.status(403).json({
        error: "This shift is closed (End Shift verified by the guard) — check-in/out times, battery and odometer can only be changed by an admin now.",
      });
      return;
    }
  }

  let record;
  try {
    [record] = await db.update(attendanceTable).set(parsed.data).where(eq(attendanceTable.id, params.data.id)).returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another attendance record already exists for this rider on this date." });
      return;
    }
    throw err;
  }
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }

  // Admin changed guard-log data on a closed day → the shift hours (and pay)
  // may have changed; recompute with the usual old→new audit.
  if (touchesLocked && closedDay) {
    computeAndLockPay(record.riderId, record.date, {
      userId: req.session.userId ?? null,
      userName: req.session.userName ?? "Unknown",
    }).catch((err) => console.error("[pay-engine] recompute after attendance edit failed (non-fatal):", err));
  }

  const [row] = await db
    .select(attendanceSelect)
    .from(attendanceTable)
    .leftJoin(ridersTable, eq(attendanceTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(attendanceTable.vehicleId, vehiclesTable.id))
    .where(eq(attendanceTable.id, record.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "attendance", `Updated attendance for ${row?.riderName ?? `rider #${record.riderId}`} on ${record.date} → ${record.type}`);
  res.json(row);
});

router.delete("/attendance/:id", requirePermission("attendance", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db.delete(attendanceTable).where(eq(attendanceTable.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "attendance", `Deleted attendance record #${record.id} for rider #${record.riderId} on ${record.date}`);
  res.sendStatus(204);
});

export default router;
