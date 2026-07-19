import { Router, type IRouter } from "express";
import pg from "pg";
import { pool as targetPool } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TEMP MIGRATION TOOL — REMOVE AFTER CUTOVER                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * POST /api/admin/sync-from-production  (admin only)
 *
 * Pulls all data from the Replit/Neon production database into the database this
 * app is currently connected to. STRICTLY ONE-WAY:
 *   - the production connection is forced READ ONLY — it can only SELECT.
 *   - all writes (TRUNCATE + INSERT) happen on the LOCAL/target database only.
 *
 * Gated by: requireAdmin + presence of SOURCE_DATABASE_URL on the server. When
 * SOURCE_DATABASE_URL is unset (e.g. normal production), the endpoint is a no-op
 * that returns 400. Delete this file + its mount + the frontend button at cutover.
 */

const { Pool } = pg;

const router: IRouter = Router();
const adminGuard = requireAdmin();

// FK-safe insert order. `session` (login cookies) is intentionally excluded so the
// running admin isn't logged out mid-sync, and because it isn't real data.
const TABLES_IN_ORDER = [
  "users",
  "user_permissions",
  "vehicles",
  "riders",
  "expense_categories",
  "assignments",
  "attendance",
  "daily_logs",
  "cash_collections",
  "maintenance",
  "service_history",
  "expenses",
  "salary_payments",
  "salary_advances",
  "rider_daily_targets",
  "rider_ride_stats",
  "rider_target_overrides",
  "activity_logs",
];

type PgClient = pg.PoolClient;

async function tableColumns(client: PgClient, table: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name as string);
}

router.post("/admin/sync-from-production", adminGuard, async (_req, res): Promise<void> => {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    res.status(400).json({
      error:
        "SOURCE_DATABASE_URL is not set on the server. Set it (the Replit/Neon production connection string) and restart the API to enable the sync.",
    });
    return;
  }

  const source = new Pool({
    connectionString: sourceUrl,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
    max: 2,
  });

  const results: Array<{ table: string; status: string; copied: number }> = [];

  try {
    const src = await source.connect();
    let tgt: PgClient | null = null;
    try {
      // ── HARD READ-ONLY GUARD: this connection physically cannot write. ──
      await src.query("SET default_transaction_read_only = on");

      tgt = await targetPool.connect();

      // Which of our tables actually exist on each side?
      const presentOnTarget: string[] = [];
      const presentOnSource: string[] = [];
      for (const t of TABLES_IN_ORDER) {
        if ((await tableColumns(tgt, t)).length > 0) presentOnTarget.push(t);
        if ((await tableColumns(src, t)).length > 0) presentOnSource.push(t);
      }

      await tgt.query("BEGIN");

      // Clear the target up-front (atomic + idempotent). Local DB only.
      if (presentOnTarget.length > 0) {
        const list = presentOnTarget.map((t) => `"${t}"`).join(", ");
        await tgt.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      }

      for (const table of TABLES_IN_ORDER) {
        const onTarget = presentOnTarget.includes(table);
        const onSource = presentOnSource.includes(table);
        if (!onSource) {
          results.push({ table, status: "skipped (not in production)", copied: 0 });
          continue;
        }
        if (!onTarget) {
          results.push({ table, status: "skipped (not in local schema)", copied: 0 });
          continue;
        }

        const srcCols = await tableColumns(src, table);
        const tgtCols = new Set(await tableColumns(tgt, table));
        const cols = srcCols.filter((c) => tgtCols.has(c));
        const colList = cols.map((c) => `"${c}"`).join(", ");

        const { rows } = await src.query(`SELECT ${colList} FROM "${table}"`);

        // Batched multi-row INSERTs — one round-trip per chunk instead of per row.
        // Critical across regions: row-by-row over WAN times out on large tables.
        // Cap chunk so params (chunk * cols) stays well under Postgres' 65535 limit.
        const maxParams = 50000;
        const chunkSize = Math.max(1, Math.min(1000, Math.floor(maxParams / Math.max(1, cols.length))));
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const values: unknown[] = [];
          const tuples = chunk.map((row) => {
            const ph = cols.map((c) => {
              values.push(row[c]);
              return `$${values.length}`;
            });
            return `(${ph.join(", ")})`;
          });
          await tgt.query(
            `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(", ")}`,
            values,
          );
        }

        // Keep the id sequence ahead of the copied rows.
        if (cols.includes("id")) {
          await tgt.query(
            `SELECT setval(
               pg_get_serial_sequence('${table}', 'id'),
               COALESCE((SELECT MAX(id) FROM "${table}"), 1),
               (SELECT COUNT(*) FROM "${table}") > 0
             )`,
          );
        }

        results.push({ table, status: "copied", copied: rows.length });
      }

      await tgt.query("COMMIT");
    } catch (err) {
      if (tgt) await tgt.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      if (tgt) tgt.release();
      src.release();
    }

    const totalCopied = results.reduce((sum, r) => sum + r.copied, 0);
    res.json({ ok: true, totalCopied, results });
  } catch (error) {
    console.error({ err: error }, "Production sync failed");
    res.status(500).json({ error: (error as Error).message || "Sync failed" });
  } finally {
    await source.end().catch(() => {});
  }
});

export default router;
