import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, cashCollectionsTable, ridersTable, dailyLogsTable } from "@workspace/db";
import { z } from "zod/v4";
import { requirePermission } from "../middlewares/auth";
import { logActivity } from "../lib/activity-logger";
import { computeAndLockPay } from "../lib/pay-engine";

const router: IRouter = Router();

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const RecordParams = z.object({ id: z.coerce.number().int().positive() });

const UpsertBody = z.object({
  riderId: z.coerce.number().int().positive(),
  englishDate: z.string().min(1),
  nepaliDate: z.string().optional().nullable(),
  cashTotal: z.string().default("0"),
  walletAmount: z.string().default("0"),
  grandTotal: z.string().optional(),
  note: z.string().optional().nullable(),
});

const ApproveBody = z.object({ approvalNote: z.string().optional().nullable() });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeTotals(data: z.infer<typeof UpsertBody>) {
  const cash = parseFloat(data.cashTotal || "0") || 0;
  const wallet = parseFloat(data.walletAmount || "0") || 0;
  return {
    cashTotal: cash.toFixed(2),
    grandTotal: (cash + wallet).toFixed(2),
  };
}

async function isAdmin(userId: number): Promise<boolean> {
  const { userPermissionsTable } = await import("@workspace/db");
  const perms = await db.select().from(userPermissionsTable).where(eq(userPermissionsTable.userId, userId));
  const ADMIN_SECTIONS = ["dashboard", "daily-logs", "vehicles", "riders", "assignments", "attendance", "maintenance", "financials", "reports", "salary"];
  return ADMIN_SECTIONS.every((section) => {
    const perm = perms.find((p) => p.section === section);
    return perm && perm.canView && perm.canCreate && perm.canEdit && perm.canDelete;
  });
}

async function enrichWithVariance(rows: typeof cashCollectionsTable.$inferSelect[]) {
  return Promise.all(
    rows.map(async (row) => {
      const [log] = await db
        .select({
          cashGivenByDriver: dailyLogsTable.cashGivenByDriver,
          cashTransferredOnline: dailyLogsTable.cashTransferredOnline,
          dailyAllowance: dailyLogsTable.dailyAllowance,
        })
        .from(dailyLogsTable)
        .where(
          and(
            eq(dailyLogsTable.riderId, row.riderId),
            eq(dailyLogsTable.englishDate, row.englishDate)
          )
        )
        .limit(1);

      const dailyLogCash = parseFloat(log?.cashGivenByDriver || "0") || 0;
      const dailyLogOnline = parseFloat(log?.cashTransferredOnline || "0") || 0;
      // Riders are allowed to deduct their daily allowance before handing over cash.
      // Expected cash handover = cashGivenByDriver − dailyAllowance
      const allowance = parseFloat(log?.dailyAllowance || "0") || 0;
      const expectedCash = Math.max(0, dailyLogCash - allowance);
      const collectedCash = parseFloat(row.cashTotal || "0") || 0;
      const collectedOnline = parseFloat(row.walletAmount || "0") || 0;

      return {
        ...row,
        dailyLogCash: dailyLogCash.toFixed(2),
        dailyLogOnline: dailyLogOnline.toFixed(2),
        dailyAllowance: allowance.toFixed(2),
        varianceCash: (collectedCash - expectedCash).toFixed(2),
        varianceOnline: (collectedOnline - dailyLogOnline).toFixed(2),
        varianceTotal: (collectedCash + collectedOnline - expectedCash - dailyLogOnline).toFixed(2),
      };
    })
  );
}

// ─── GET /cash-collection ─────────────────────────────────────────────────────

router.get("/cash-collection", requirePermission("cash-collection", "canView"), async (req, res): Promise<void> => {
  const { dateFrom, dateTo, riderId } = req.query as Record<string, string>;

  const conditions = [];
  if (dateFrom) conditions.push(gte(cashCollectionsTable.englishDate, dateFrom));
  if (dateTo) conditions.push(lte(cashCollectionsTable.englishDate, dateTo));
  if (riderId) conditions.push(eq(cashCollectionsTable.riderId, parseInt(riderId, 10)));

  const rows = await db
    .select({
      id: cashCollectionsTable.id,
      riderId: cashCollectionsTable.riderId,
      riderName: ridersTable.fullName,
      englishDate: cashCollectionsTable.englishDate,
      nepaliDate: cashCollectionsTable.nepaliDate,
      denom1000: cashCollectionsTable.denom1000,
      denom500: cashCollectionsTable.denom500,
      denom100: cashCollectionsTable.denom100,
      denom50: cashCollectionsTable.denom50,
      denom20: cashCollectionsTable.denom20,
      denom10: cashCollectionsTable.denom10,
      cashTotal: cashCollectionsTable.cashTotal,
      walletAmount: cashCollectionsTable.walletAmount,
      grandTotal: cashCollectionsTable.grandTotal,
      note: cashCollectionsTable.note,
      submittedBy: cashCollectionsTable.submittedBy,
      submittedByName: cashCollectionsTable.submittedByName,
      submittedAt: cashCollectionsTable.submittedAt,
      approvalStatus: cashCollectionsTable.approvalStatus,
      approvedBy: cashCollectionsTable.approvedBy,
      approvedByName: cashCollectionsTable.approvedByName,
      approvedAt: cashCollectionsTable.approvedAt,
      approvalNote: cashCollectionsTable.approvalNote,
    })
    .from(cashCollectionsTable)
    .leftJoin(ridersTable, eq(cashCollectionsTable.riderId, ridersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(cashCollectionsTable.englishDate, cashCollectionsTable.id);

  const enriched = await enrichWithVariance(rows as typeof cashCollectionsTable.$inferSelect[]);
  res.json(enriched);
});

// ─── POST /cash-collection ────────────────────────────────────────────────────

router.post("/cash-collection", requirePermission("cash-collection", "canCreate"), async (req, res): Promise<void> => {
  const parsed = UpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cashTotal, grandTotal } = computeTotals(parsed.data);
  const submittedAt = new Date();

  const [record] = await db
    .insert(cashCollectionsTable)
    .values({
      ...parsed.data,
      cashTotal,
      grandTotal,
      submittedBy: req.session.userId ?? null,
      submittedByName: req.session.userName ?? "Unknown",
      submittedAt,
      approvalStatus: "pending",
    })
    .returning();

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "created",
    "cash-collection",
    `Submitted cash collection for rider #${record.riderId} on ${record.englishDate}`
  );

  const enriched = await enrichWithVariance([record]);
  res.status(201).json(enriched[0]);
});

// ─── PUT /cash-collection/:id ─────────────────────────────────────────────────

router.put("/cash-collection/:id", requirePermission("cash-collection", "canEdit"), async (req, res): Promise<void> => {
  const params = RecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(cashCollectionsTable)
    .where(eq(cashCollectionsTable.id, params.data.id));

  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  const userId = req.session.userId!;
  const userIsAdmin = await isAdmin(userId);
  const elapsed = Date.now() - new Date(existing.submittedAt).getTime();

  if (!userIsAdmin && elapsed > EDIT_WINDOW_MS) {
    res.status(403).json({ error: "Edit window has expired. Only admins can edit locked records." });
    return;
  }

  const parsed = UpsertBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const merged = { ...existing, ...parsed.data } as z.infer<typeof UpsertBody>;
  const { cashTotal, grandTotal } = computeTotals(merged);

  const [updated] = await db
    .update(cashCollectionsTable)
    .set({ ...parsed.data, cashTotal, grandTotal })
    .where(eq(cashCollectionsTable.id, params.data.id))
    .returning();

  logActivity(
    userId,
    req.session.userName ?? "Unknown",
    "updated",
    "cash-collection",
    `Updated cash collection #${updated.id}`
  );

  const enriched = await enrichWithVariance([updated]);
  res.json(enriched[0]);
});

// ─── DELETE /cash-collection/:id ──────────────────────────────────────────────

router.delete("/cash-collection/:id", requirePermission("cash-collection", "canDelete"), async (req, res): Promise<void> => {
  const params = RecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [record] = await db
    .delete(cashCollectionsTable)
    .where(eq(cashCollectionsTable.id, params.data.id))
    .returning();

  if (!record) { res.status(404).json({ error: "Record not found" }); return; }

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "deleted",
    "cash-collection",
    `Deleted cash collection #${record.id}`
  );
  res.sendStatus(204);
});

// ─── POST /cash-collection/:id/approve ───────────────────────────────────────

router.post("/cash-collection/:id/approve", requirePermission("cash-collection", "canEdit"), async (req, res): Promise<void> => {
  const params = RecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [record] = await db
    .update(cashCollectionsTable)
    .set({
      approvalStatus: "approved",
      approvedBy: req.session.userId ?? null,
      approvedByName: req.session.userName ?? "Unknown",
      approvedAt: new Date(),
      approvalNote: null,
    })
    .where(eq(cashCollectionsTable.id, params.data.id))
    .returning();

  if (!record) { res.status(404).json({ error: "Record not found" }); return; }

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "updated",
    "cash-collection",
    `Approved cash collection #${record.id}`
  );

  // Day-lock: finance approval is the Variable Pay Engine's trigger for pilot
  // riders. Fire-and-forget — a pay-engine hiccup must never block approval.
  computeAndLockPay(record.riderId, record.englishDate, {
    userId: req.session.userId ?? null,
    userName: req.session.userName ?? "Unknown",
  }).catch((err) => console.error("[pay-engine] lock failed (non-fatal):", err));

  const enriched = await enrichWithVariance([record]);
  res.json(enriched[0]);
});

// ─── POST /cash-collection/:id/disapprove ────────────────────────────────────

router.post("/cash-collection/:id/disapprove", requirePermission("cash-collection", "canEdit"), async (req, res): Promise<void> => {
  const params = RecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = ApproveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [record] = await db
    .update(cashCollectionsTable)
    .set({
      approvalStatus: "disapproved",
      approvedBy: req.session.userId ?? null,
      approvedByName: req.session.userName ?? "Unknown",
      approvedAt: new Date(),
      approvalNote: parsed.data.approvalNote ?? null,
    })
    .where(eq(cashCollectionsTable.id, params.data.id))
    .returning();

  if (!record) { res.status(404).json({ error: "Record not found" }); return; }

  logActivity(
    req.session.userId ?? null,
    req.session.userName ?? "Unknown",
    "updated",
    "cash-collection",
    `Disapproved cash collection #${record.id} — ${parsed.data.approvalNote ?? "no reason"}`
  );

  const enriched = await enrichWithVariance([record]);
  res.json(enriched[0]);
});

export default router;
