import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, maintenanceTable, vehiclesTable } from "@workspace/db";
import {
  ListMaintenanceQueryParams,
  CreateMaintenanceBody,
  UpdateMaintenanceParams,
  UpdateMaintenanceBody,
  DeleteMaintenanceParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const router: IRouter = Router();

const maintenanceSelect = {
  id: maintenanceTable.id,
  vehicleId: maintenanceTable.vehicleId,
  vehiclePlate: vehiclesTable.plateNumber,
  maintenanceType: maintenanceTable.maintenanceType,
  date: maintenanceTable.date,
  cost: maintenanceTable.cost,
  description: maintenanceTable.description,
  nextServiceDate: maintenanceTable.nextServiceDate,
  createdAt: maintenanceTable.createdAt,
};

router.get("/maintenance", requirePermission("maintenance", "canView"), async (req, res): Promise<void> => {
  const query = ListMaintenanceQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.vehicleId) {
    conditions.push(eq(maintenanceTable.vehicleId, query.data.vehicleId));
  }
  if (query.success && query.data.type) {
    conditions.push(eq(maintenanceTable.maintenanceType, query.data.type));
  }

  const rows = await db
    .select(maintenanceSelect)
    .from(maintenanceTable)
    .leftJoin(vehiclesTable, eq(maintenanceTable.vehicleId, vehiclesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(maintenanceTable.id);

  res.json(rows);
});

router.post("/maintenance", requirePermission("maintenance", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateMaintenanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [record] = await db.insert(maintenanceTable).values(parsed.data).returning();

  const [row] = await db
    .select(maintenanceSelect)
    .from(maintenanceTable)
    .leftJoin(vehiclesTable, eq(maintenanceTable.vehicleId, vehiclesTable.id))
    .where(eq(maintenanceTable.id, record.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "maintenance", `Logged ${record.maintenanceType} maintenance for vehicle ${row?.vehiclePlate ?? `#${record.vehicleId}`} on ${record.date}`);
  res.status(201).json(row);
});

router.put("/maintenance/:id", requirePermission("maintenance", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateMaintenanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateMaintenanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [record] = await db.update(maintenanceTable).set(parsed.data).where(eq(maintenanceTable.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Maintenance record not found" });
    return;
  }

  const [row] = await db
    .select(maintenanceSelect)
    .from(maintenanceTable)
    .leftJoin(vehiclesTable, eq(maintenanceTable.vehicleId, vehiclesTable.id))
    .where(eq(maintenanceTable.id, record.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "maintenance", `Updated ${record.maintenanceType} maintenance for vehicle ${row?.vehiclePlate ?? `#${record.vehicleId}`}`);
  res.json(row);
});

router.delete("/maintenance/:id", requirePermission("maintenance", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteMaintenanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db.delete(maintenanceTable).where(eq(maintenanceTable.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Maintenance record not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "maintenance", `Deleted maintenance record #${record.id} for vehicle #${record.vehicleId}`);
  res.sendStatus(204);
});

export default router;
