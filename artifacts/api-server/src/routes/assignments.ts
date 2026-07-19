import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assignmentsTable, ridersTable, vehiclesTable } from "@workspace/db";
import {
  ListAssignmentsQueryParams,
  CreateAssignmentBody,
  UpdateAssignmentParams,
  UpdateAssignmentBody,
  DeleteAssignmentParams,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const router: IRouter = Router();

const assignmentSelect = {
  id: assignmentsTable.id,
  riderId: assignmentsTable.riderId,
  vehicleId: assignmentsTable.vehicleId,
  riderName: ridersTable.fullName,
  vehiclePlate: vehiclesTable.plateNumber,
  startDate: assignmentsTable.startDate,
  endDate: assignmentsTable.endDate,
  shiftType: assignmentsTable.shiftType,
  status: assignmentsTable.status,
  createdAt: assignmentsTable.createdAt,
};

router.get("/assignments", requirePermission("assignments", "canView"), async (req, res): Promise<void> => {
  const query = ListAssignmentsQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) {
    conditions.push(eq(assignmentsTable.status, query.data.status));
  }
  if (query.success && query.data.riderId) {
    conditions.push(eq(assignmentsTable.riderId, query.data.riderId));
  }
  if (query.success && query.data.vehicleId) {
    conditions.push(eq(assignmentsTable.vehicleId, query.data.vehicleId));
  }

  const rows = await db
    .select(assignmentSelect)
    .from(assignmentsTable)
    .leftJoin(ridersTable, eq(assignmentsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(assignmentsTable.vehicleId, vehiclesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assignmentsTable.id);

  res.json(rows);
});

router.post("/assignments", requirePermission("assignments", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!parsed.data.status || parsed.data.status === "active") {
    const existingVehicle = await db
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.vehicleId, parsed.data.vehicleId),
          eq(assignmentsTable.status, "active")
        )
      );

    if (existingVehicle.length > 0) {
      res.status(400).json({ error: "Vehicle already has an active assignment" });
      return;
    }

    const existingRider = await db
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.riderId, parsed.data.riderId),
          eq(assignmentsTable.status, "active")
        )
      );

    if (existingRider.length > 0) {
      res.status(400).json({ error: "Rider already has an active assignment" });
      return;
    }
  }

  const [assignment] = await db.insert(assignmentsTable).values({
    ...parsed.data,
    status: parsed.data.status || "active",
  }).returning();

  const [row] = await db
    .select(assignmentSelect)
    .from(assignmentsTable)
    .leftJoin(ridersTable, eq(assignmentsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(assignmentsTable.vehicleId, vehiclesTable.id))
    .where(eq(assignmentsTable.id, assignment.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "assignments", `Assigned rider ${row?.riderName ?? `#${assignment.riderId}`} to vehicle ${row?.vehiclePlate ?? `#${assignment.vehicleId}`}`);
  res.status(201).json(row);
});

router.put("/assignments/:id", requirePermission("assignments", "canEdit"), async (req, res): Promise<void> => {
  const params = UpdateAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.vehicleId || parsed.data.riderId || parsed.data.status === "active") {
    const [current] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, params.data.id));
    if (current) {
      const targetVehicleId = parsed.data.vehicleId || current.vehicleId;
      const targetRiderId = parsed.data.riderId || current.riderId;
      const targetStatus = parsed.data.status || current.status;
      if (targetStatus === "active") {
        const existingVehicle = await db
          .select()
          .from(assignmentsTable)
          .where(
            and(
              eq(assignmentsTable.vehicleId, targetVehicleId),
              eq(assignmentsTable.status, "active")
            )
          );
        if (existingVehicle.filter(a => a.id !== params.data.id).length > 0) {
          res.status(400).json({ error: "Vehicle already has an active assignment" });
          return;
        }

        const existingRider = await db
          .select()
          .from(assignmentsTable)
          .where(
            and(
              eq(assignmentsTable.riderId, targetRiderId),
              eq(assignmentsTable.status, "active")
            )
          );
        if (existingRider.filter(a => a.id !== params.data.id).length > 0) {
          res.status(400).json({ error: "Rider already has an active assignment" });
          return;
        }
      }
    }
  }

  const [assignment] = await db.update(assignmentsTable).set(parsed.data).where(eq(assignmentsTable.id, params.data.id)).returning();
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const [row] = await db
    .select(assignmentSelect)
    .from(assignmentsTable)
    .leftJoin(ridersTable, eq(assignmentsTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(assignmentsTable.vehicleId, vehiclesTable.id))
    .where(eq(assignmentsTable.id, assignment.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "assignments", `Updated assignment: rider ${row?.riderName ?? `#${assignment.riderId}`} / vehicle ${row?.vehiclePlate ?? `#${assignment.vehicleId}`} → ${assignment.status}`);
  res.json(row);
});

router.delete("/assignments/:id", requirePermission("assignments", "canDelete"), async (req, res): Promise<void> => {
  const params = DeleteAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [assignment] = await db.delete(assignmentsTable).where(eq(assignmentsTable.id, params.data.id)).returning();
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "assignments", `Deleted assignment #${assignment.id} (rider #${assignment.riderId} / vehicle #${assignment.vehicleId})`);
  res.sendStatus(204);
});

export default router;
