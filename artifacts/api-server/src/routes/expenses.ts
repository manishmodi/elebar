import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, expenseCategoriesTable, expensesTable, ridersTable, vehiclesTable } from "@workspace/db";
import { z } from "zod/v4";
import { requirePermission, requireAdmin } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";

const router: IRouter = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CreateCategoryBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const UpdateCategoryBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const CategoryParams = z.object({ id: z.coerce.number().int().positive() });

const CreateExpenseBody = z.object({
  categoryId: z.coerce.number().int().positive(),
  date: z.string().min(1),
  amount: z.string().min(1),
  notes: z.string().optional(),
  riderId: z.coerce.number().int().positive().optional().nullable(),
  vehicleId: z.coerce.number().int().positive().optional().nullable(),
});

const ExpenseParams = z.object({ id: z.coerce.number().int().positive() });

// ─── Expense Category Routes ─────────────────────────────────────────────────

router.get("/expense-categories", requirePermission("expenses", "canView"), async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(expenseCategoriesTable)
    .orderBy(expenseCategoriesTable.name);
  res.json(rows);
});

router.post("/expense-categories", requireAdmin(), async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(expenseCategoriesTable).values(parsed.data).returning();
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "created", "expenses", `Created expense category: ${row.name}`);
  res.status(201).json(row);
});

router.put("/expense-categories/:id", requireAdmin(), async (req, res): Promise<void> => {
  const params = CategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(expenseCategoriesTable).set(parsed.data).where(eq(expenseCategoriesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Category not found" }); return; }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "expenses", `Updated expense category: ${row.name}`);
  res.json(row);
});

router.delete("/expense-categories/:id", requireAdmin(), async (req, res): Promise<void> => {
  const params = CategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Category not found" }); return; }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "expenses", `Deleted expense category: ${row.name}`);
  res.sendStatus(204);
});

// ─── Expense Routes ───────────────────────────────────────────────────────────

const expenseSelect = {
  id: expensesTable.id,
  categoryId: expensesTable.categoryId,
  categoryName: expenseCategoriesTable.name,
  date: expensesTable.date,
  amount: expensesTable.amount,
  notes: expensesTable.notes,
  riderId: expensesTable.riderId,
  riderName: ridersTable.fullName,
  vehicleId: expensesTable.vehicleId,
  vehiclePlate: vehiclesTable.plateNumber,
  createdBy: expensesTable.createdBy,
  createdAt: expensesTable.createdAt,
};

router.get("/expenses", requirePermission("expenses", "canView"), async (_req, res): Promise<void> => {
  const rows = await db
    .select(expenseSelect)
    .from(expensesTable)
    .leftJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
    .leftJoin(ridersTable, eq(expensesTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(expensesTable.vehicleId, vehiclesTable.id))
    .orderBy(expensesTable.date);
  res.json(rows);
});

router.post("/expenses", requirePermission("expenses", "canCreate"), async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const createdBy = req.session.userName ?? "Unknown";
  const [record] = await db.insert(expensesTable).values({ ...parsed.data, createdBy }).returning();

  const [row] = await db
    .select(expenseSelect)
    .from(expensesTable)
    .leftJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
    .leftJoin(ridersTable, eq(expensesTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(expensesTable.vehicleId, vehiclesTable.id))
    .where(eq(expensesTable.id, record.id));

  logActivity(req.session.userId ?? null, createdBy, "created", "expenses", `Booked expense रू${record.amount} on ${record.date}`);
  res.status(201).json(row);
});

router.put("/expenses/:id", requirePermission("expenses", "canEdit"), async (req, res): Promise<void> => {
  const params = ExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CreateExpenseBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [record] = await db.update(expensesTable).set(parsed.data).where(eq(expensesTable.id, params.data.id)).returning();
  if (!record) { res.status(404).json({ error: "Expense not found" }); return; }

  const [row] = await db
    .select(expenseSelect)
    .from(expensesTable)
    .leftJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
    .leftJoin(ridersTable, eq(expensesTable.riderId, ridersTable.id))
    .leftJoin(vehiclesTable, eq(expensesTable.vehicleId, vehiclesTable.id))
    .where(eq(expensesTable.id, record.id));

  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "updated", "expenses", `Updated expense #${record.id}`);
  res.json(row);
});

router.delete("/expenses/:id", requirePermission("expenses", "canDelete"), async (req, res): Promise<void> => {
  const params = ExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [record] = await db.delete(expensesTable).where(eq(expensesTable.id, params.data.id)).returning();
  if (!record) { res.status(404).json({ error: "Expense not found" }); return; }
  logActivity(req.session.userId ?? null, req.session.userName ?? "Unknown", "deleted", "expenses", `Deleted expense #${record.id}`);
  res.sendStatus(204);
});

export default router;
