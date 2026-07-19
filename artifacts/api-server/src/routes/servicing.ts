import { Router, type IRouter } from "express";
import { eq, desc, and, isNotNull, ne, sql } from "drizzle-orm";
import { db, vehiclesTable, attendanceTable, serviceHistoryTable } from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";
import { z } from "zod/v4";

const router: IRouter = Router();

const SERVICE_INTERVAL_KM = 2000;
const DUE_SOON_THRESHOLD = 1500;

function getServiceStatus(kmSinceLast: number | null): "ok" | "due_soon" | "overdue" | "unknown" {
  if (kmSinceLast === null) return "unknown";
  if (kmSinceLast >= SERVICE_INTERVAL_KM) return "overdue";
  if (kmSinceLast >= DUE_SOON_THRESHOLD) return "due_soon";
  return "ok";
}

// GET /servicing/status — per-vehicle service status
router.get("/servicing/status", requirePermission("maintenance", "canView"), async (req, res): Promise<void> => {
  const vehicles = await db
    .select({
      id: vehiclesTable.id,
      vehicleNumber: vehiclesTable.vehicleNumber,
      plateNumber: vehiclesTable.plateNumber,
      lastServiceDate: vehiclesTable.lastServiceDate,
      lastServiceOdometer: vehiclesTable.lastServiceOdometer,
      status: vehiclesTable.status,
      inServicingSince: vehiclesTable.inServicingSince,
    })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.status, "active"))
    .orderBy(vehiclesTable.id);

  const statusList = await Promise.all(
    vehicles.map(async (v) => {
      const [latestAtt] = await db
        .select({ distanceOut: attendanceTable.distanceOut, date: attendanceTable.date })
        .from(attendanceTable)
        .where(and(
          eq(attendanceTable.vehicleId, v.id),
          isNotNull(attendanceTable.distanceOut),
          ne(attendanceTable.distanceOut, '0'),
          ne(attendanceTable.distanceOut, ''),
          sql`${attendanceTable.distanceOut} ~ '^[1-9][0-9]*$'`
        ))
        // Order by the attendance DATE, not created_at: the rider-app verify
        // flow UPDATES the day's existing row (created in the morning), so
        // created_at no longer tracks which odometer reading is newest.
        .orderBy(desc(attendanceTable.date), desc(attendanceTable.createdAt))
        .limit(1);

      const currentOdometer =
        latestAtt?.distanceOut ? parseInt(latestAtt.distanceOut) : null;
      const kmSinceLast =
        currentOdometer !== null && v.lastServiceOdometer !== null
          ? currentOdometer - v.lastServiceOdometer
          : null;
      const kmUntilNext = kmSinceLast !== null ? SERVICE_INTERVAL_KM - kmSinceLast : null;

      return {
        ...v,
        currentOdometer,
        lastOdometerDate: latestAtt?.date ?? null,
        kmSinceLast,
        kmUntilNext,
        serviceStatus: getServiceStatus(kmSinceLast),
      };
    })
  );

  res.json(statusList);
});

// GET /servicing/history
router.get("/servicing/history", requirePermission("maintenance", "canView"), async (req, res): Promise<void> => {
  const vehicleIdRaw = req.query.vehicleId;
  const conditions = [];
  if (vehicleIdRaw) {
    conditions.push(eq(serviceHistoryTable.vehicleId, parseInt(vehicleIdRaw as string)));
  }

  const rows = await db
    .select({
      id: serviceHistoryTable.id,
      vehicleId: serviceHistoryTable.vehicleId,
      vehiclePlate: vehiclesTable.plateNumber,
      vehicleNumber: vehiclesTable.vehicleNumber,
      serviceDate: serviceHistoryTable.serviceDate,
      odometerAtService: serviceHistoryTable.odometerAtService,
      notes: serviceHistoryTable.notes,
      cost: serviceHistoryTable.cost,
      createdAt: serviceHistoryTable.createdAt,
    })
    .from(serviceHistoryTable)
    .leftJoin(vehiclesTable, eq(serviceHistoryTable.vehicleId, vehiclesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(serviceHistoryTable.id));

  res.json(rows);
});

const CreateServiceHistoryBody = z.object({
  vehicleId: z.number().int().positive(),
  serviceDate: z.string().min(1),
  odometerAtService: z.number().int().nonnegative(),
  notes: z.string().optional(),
  cost: z.string().optional(),
});

// POST /servicing/history — log a service + update vehicle last service info
router.post("/servicing/history", requirePermission("maintenance", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateServiceHistoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { vehicleId, serviceDate, odometerAtService, notes, cost } = parsed.data;

  const [record] = await db
    .insert(serviceHistoryTable)
    .values({ vehicleId, serviceDate, odometerAtService, notes, cost })
    .returning();

  // Update the vehicle's lastServiceDate and lastServiceOdometer, and clear the
  // "in servicing" flag if it was set (servicing is now complete).
  await db
    .update(vehiclesTable)
    .set({ lastServiceDate: serviceDate, lastServiceOdometer: odometerAtService, inServicingSince: null })
    .where(eq(vehiclesTable.id, vehicleId));

  const [row] = await db
    .select({
      id: serviceHistoryTable.id,
      vehicleId: serviceHistoryTable.vehicleId,
      vehiclePlate: vehiclesTable.plateNumber,
      vehicleNumber: vehiclesTable.vehicleNumber,
      serviceDate: serviceHistoryTable.serviceDate,
      odometerAtService: serviceHistoryTable.odometerAtService,
      notes: serviceHistoryTable.notes,
      cost: serviceHistoryTable.cost,
      createdAt: serviceHistoryTable.createdAt,
    })
    .from(serviceHistoryTable)
    .leftJoin(vehiclesTable, eq(serviceHistoryTable.vehicleId, vehiclesTable.id))
    .where(eq(serviceHistoryTable.id, record.id));

  const vehicle = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId)).limit(1);
  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "created",
    "maintenance",
    `Logged servicing for vehicle ${vehicle[0]?.plateNumber ?? `#${vehicleId}`} at ${odometerAtService} km on ${serviceDate}`
  );

  res.status(201).json(row);
});

// POST /servicing/send — flag a vehicle as currently sent for servicing.
// Cleared automatically when the next /servicing/history record is logged for the vehicle.
const SendForServicingBody = z.object({ vehicleId: z.number().int().positive() });
router.post("/servicing/send", requirePermission("maintenance", "canCreate"), async (req, res): Promise<void> => {
  const parsed = SendForServicingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { vehicleId } = parsed.data;

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  if (vehicle.inServicingSince) {
    res.status(409).json({ error: "Vehicle is already flagged as in servicing" });
    return;
  }

  await db.update(vehiclesTable).set({ inServicingSince: new Date() }).where(eq(vehiclesTable.id, vehicleId));

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "updated",
    "maintenance",
    `Sent vehicle ${vehicle.plateNumber} for servicing`
  );

  res.status(200).json({ ok: true, vehicleId, inServicingSince: new Date().toISOString() });
});

// POST /servicing/cancel — clear the "in servicing" flag without logging a service.
const CancelServicingBody = z.object({ vehicleId: z.number().int().positive() });
router.post("/servicing/cancel", requirePermission("maintenance", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CancelServicingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { vehicleId } = parsed.data;

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  if (!vehicle.inServicingSince) {
    res.status(409).json({ error: "Vehicle is not currently flagged as in servicing" });
    return;
  }

  await db.update(vehiclesTable).set({ inServicingSince: null }).where(eq(vehiclesTable.id, vehicleId));

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "updated",
    "maintenance",
    `Cancelled servicing flag for vehicle ${vehicle.plateNumber}`
  );

  res.status(200).json({ ok: true, vehicleId });
});

const DeleteServiceHistoryParams = z.object({ id: z.coerce.number().int() });

// DELETE /servicing/history/:id
router.delete("/servicing/history/:id", requirePermission("maintenance", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteServiceHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .delete(serviceHistoryTable)
    .where(eq(serviceHistoryTable.id, params.data.id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Service record not found" });
    return;
  }

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "deleted",
    "maintenance",
    `Deleted service history record #${record.id} for vehicle #${record.vehicleId}`
  );
  res.sendStatus(204);
});

export default router;
