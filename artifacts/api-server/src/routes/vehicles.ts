import { Router, type IRouter } from "express";
import { eq, ilike, and, or, count, sql } from "drizzle-orm";
import { db, vehiclesTable, dailyLogsTable, assignmentsTable, maintenanceTable, fleetHandoversTable } from "@workspace/db";
import {
  ListVehiclesQueryParams,
  CreateVehicleBody,
  GetVehicleParams,
  UpdateVehicleParams,
  UpdateVehicleBody,
  DeleteVehicleParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const router: IRouter = Router();

router.get("/vehicles", requirePermission("vehicles", "canView"), async (req, res): Promise<void> => {
  const query = ListVehiclesQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) {
    conditions.push(eq(vehiclesTable.status, query.data.status));
  }
  if (query.success && query.data.search) {
    conditions.push(
      or(
        ilike(vehiclesTable.plateNumber, `%${query.data.search}%`),
        ilike(vehiclesTable.vehicleNumber, `%${query.data.search}%`),
        ilike(vehiclesTable.brand, `%${query.data.search}%`)
      )
    );
  }

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(vehiclesTable.id);

  res.json(vehicles);
});

async function generateVehicleNumber(): Promise<string> {
  const [{ maxN }] = await db
    .select({
      maxN: sql<number>`COALESCE(MAX(CAST(SUBSTRING(vehicle_number FROM 3) AS INTEGER)) FILTER (WHERE vehicle_number ~ '^V-[0-9]+$'), 0)`,
    })
    .from(vehiclesTable);
  return `V-${String(maxN + 1).padStart(3, "0")}`;
}

router.post("/vehicles", requirePermission("vehicles", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const vehicleNumber = await generateVehicleNumber();
    try {
      const [vehicle] = await db.insert(vehiclesTable).values({ ...parsed.data, vehicleNumber }).returning();
      logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "vehicles", `Created vehicle: ${vehicle.plateNumber} (${vehicle.vehicleNumber})`);
      res.status(201).json(vehicle);
      return;
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505" && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
});

router.get("/vehicles/:id", requirePermission("vehicles", "canView"), async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(vehicle);
});

router.put("/vehicles/:id", requirePermission("vehicles", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vehicle] = await db.update(vehiclesTable).set(parsed.data).where(eq(vehiclesTable.id, params.data.id)).returning();
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "vehicles", `Updated vehicle: ${vehicle.plateNumber} (${vehicle.vehicleNumber})`);
  res.json(vehicle);
});

router.delete("/vehicles/:id", requirePermission("vehicles", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const vid = params.data.id;

  const [[{ value: logCount }], [{ value: assignCount }], [{ value: maintCount }], [{ value: handoverCount }]] = await Promise.all([
    db.select({ value: count() }).from(dailyLogsTable).where(eq(dailyLogsTable.vehicleId, vid)),
    db.select({ value: count() }).from(assignmentsTable).where(eq(assignmentsTable.vehicleId, vid)),
    db.select({ value: count() }).from(maintenanceTable).where(eq(maintenanceTable.vehicleId, vid)),
    db.select({ value: count() }).from(fleetHandoversTable).where(eq(fleetHandoversTable.vehicleId, vid)),
  ]);

  if (logCount > 0 || assignCount > 0 || maintCount > 0 || handoverCount > 0) {
    const parts: string[] = [];
    if (logCount > 0) parts.push(`${logCount} daily log(s)`);
    if (assignCount > 0) parts.push(`${assignCount} assignment(s)`);
    if (maintCount > 0) parts.push(`${maintCount} maintenance record(s)`);
    if (handoverCount > 0) parts.push(`${handoverCount} fleet handover(s)`);
    res.status(409).json({
      error: `Cannot delete vehicle — it has ${parts.join(", ")}. Set it to Inactive instead.`,
    });
    return;
  }

  try {
    const [vehicle] = await db.delete(vehiclesTable).where(eq(vehiclesTable.id, vid)).returning();
    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "vehicles", `Deleted vehicle: ${vehicle.plateNumber} (${vehicle.vehicleNumber})`);
    res.sendStatus(204);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23503") {
      res.status(409).json({ error: "Cannot delete vehicle — it still has linked records. Set it to Inactive instead." });
      return;
    }
    throw err;
  }
});

export default router;
