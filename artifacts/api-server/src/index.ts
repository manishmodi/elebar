import app from "./app";
import { seedAdmin } from "./seed-admin";
import { startDriverCache } from "./lib/yango-driver-cache.js";
import { Pool } from "pg";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureSessionTable() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid  varchar      NOT NULL COLLATE "default",
        sess json         NOT NULL,
        expire timestamp(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);
    `);
    console.log("Session table ready.");
  } finally {
    await pool.end();
  }
}

async function ensureExpenseTables() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id           SERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id           SERIAL PRIMARY KEY,
        category_id  INTEGER NOT NULL REFERENCES expense_categories(id),
        date         TEXT NOT NULL,
        amount       TEXT NOT NULL,
        notes        TEXT,
        rider_id     INTEGER REFERENCES riders(id),
        vehicle_id   INTEGER REFERENCES vehicles(id),
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("Expense tables ready.");
  } finally {
    await pool.end();
  }
}

async function ensureYangoColumns() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE riders
        ADD COLUMN IF NOT EXISTS yango_driver_id TEXT;
      ALTER TABLE daily_logs
        ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS yango_synced_at TIMESTAMPTZ;
    `);
    console.log("Yango columns ready.");
  } finally {
    await pool.end();
  }
}

async function ensureSalaryColumns() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE salary_payments
        ADD COLUMN IF NOT EXISTS salary_processed    TEXT,
        ADD COLUMN IF NOT EXISTS salary_difference   TEXT,
        ADD COLUMN IF NOT EXISTS total_cash_variance TEXT NOT NULL DEFAULT '0',
        ADD COLUMN IF NOT EXISTS pay_model           TEXT NOT NULL DEFAULT 'legacy';
    `);
    console.log("Salary columns ready.");
  } finally {
    await pool.end();
  }
}

async function ensureRiderDayUniqueIndexes() {
  // One record per rider per day — the invariant every module already assumes
  // (attendance upserts, daily-log 409 guard, cash-collection variance join).
  // Duplicates must be removed first via scripts/sql/0001-dedupe-rider-days…sql;
  // if any remain, index creation fails and is logged non-fatally below.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_rider_date_unique
        ON attendance (rider_id, date);
      CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_rider_english_date_unique
        ON daily_logs (rider_id, english_date);
      CREATE UNIQUE INDEX IF NOT EXISTS cash_collections_rider_english_date_unique
        ON cash_collections (rider_id, english_date);
    `);
    console.log("Rider-day unique indexes ready.");
  } finally {
    await pool.end();
  }
}

async function ensureFleetTables() {
  // Rider-app fleet ops + Variable Pay Engine. Must mirror lib/db/src/schema/fleet.ts
  // exactly (schema files are types only — this DDL is what actually runs in prod).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE riders
        ADD COLUMN IF NOT EXISTS fleet_pilot BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS fleet_handovers (
        id               SERIAL PRIMARY KEY,
        rider_id         INTEGER NOT NULL REFERENCES riders(id),
        english_date     TEXT NOT NULL,
        kind             TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        idempotency_key  TEXT NOT NULL,
        payload          JSONB NOT NULL,
        vehicle_id       INTEGER REFERENCES vehicles(id),
        cash_expected    TEXT,
        cash_variance    TEXT,
        submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        verified_by      INTEGER REFERENCES users(id),
        verified_by_name TEXT,
        verified_at      TIMESTAMPTZ,
        reject_reason    TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS fleet_handovers_idempotency_key_unique
        ON fleet_handovers (idempotency_key);
      CREATE INDEX IF NOT EXISTS fleet_handovers_rider_date_idx
        ON fleet_handovers (rider_id, english_date);
      CREATE INDEX IF NOT EXISTS fleet_handovers_status_idx
        ON fleet_handovers (status);

      CREATE TABLE IF NOT EXISTS pay_config (
        id             SERIAL PRIMARY KEY,
        parameter      TEXT NOT NULL,
        value          TEXT NOT NULL,
        effective_from TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pay_config_parameter_effective_unique
        ON pay_config (parameter, effective_from);

      CREATE TABLE IF NOT EXISTS pay_records (
        id            SERIAL PRIMARY KEY,
        rider_id      INTEGER NOT NULL REFERENCES riders(id),
        english_date  TEXT NOT NULL,
        base          TEXT NOT NULL DEFAULT '0',
        commission    TEXT NOT NULL DEFAULT '0',
        prize         TEXT NOT NULL DEFAULT '0',
        growth        TEXT NOT NULL DEFAULT '0',
        daily_pay     TEXT NOT NULL DEFAULT '0',
        gates_applied JSONB,
        flags         JSONB,
        status        TEXT NOT NULL DEFAULT 'computed',
        computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at     TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pay_records_rider_date_unique
        ON pay_records (rider_id, english_date);

      CREATE TABLE IF NOT EXISTS streaks (
        id                   SERIAL PRIMARY KEY,
        rider_id             INTEGER NOT NULL REFERENCES riders(id),
        current_streak       INTEGER NOT NULL DEFAULT 0,
        best_streak          INTEGER NOT NULL DEFAULT 0,
        last_qualifying_date TEXT,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS streaks_rider_unique
        ON streaks (rider_id);
    `);
    console.log("Fleet tables ready.");
  } finally {
    await pool.end();
  }
}

async function ensurePayConfigSeed() {
  // Pay Model v2 defaults, versioned from 2026-07-01. INSERT ... ON CONFLICT
  // DO NOTHING so re-boots never overwrite an admin's recalibrations; new
  // values are added as new effective_from versions via the Pay Settings UI.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      INSERT INTO pay_config (parameter, value, effective_from) VALUES
        ('fleet_enabled',   'true',  '2026-07-01'),
        ('base_amount',     '600',   '2026-07-01'),
        ('base_min_hours',  '8',     '2026-07-01'),
        ('base_min_rides',  '22',    '2026-07-01'),
        ('commission_rate', '0.20',  '2026-07-01'),
        ('revenue_cap',     '3125',  '2026-07-01'),
        ('growth_rate',     '0.40',  '2026-07-01'),
        ('streak_length',   '7',     '2026-07-01'),
        ('streak_bonus',    '500',   '2026-07-01'),
        ('monthly_floor',   '17500', '2026-07-01'),
        ('ramp', '[{"fromDay":1,"toDay":3,"gateRides":17,"gateCash":1500,"prize":200},{"fromDay":4,"toDay":7,"gateRides":22,"gateCash":2000,"prize":250},{"fromDay":8,"toDay":null,"gateRides":28,"gateCash":2500,"prize":300}]', '2026-07-01'),
        ('yango_bonus_table', '[{"trips":3,"pct":0.10,"max":50},{"trips":7,"pct":0.18,"max":190},{"trips":13,"pct":0.19,"max":335},{"trips":19,"pct":0.20,"max":520},{"trips":24,"pct":0.22,"max":695},{"trips":28,"pct":0.25,"max":895},{"trips":32,"pct":0.28,"max":1020},{"trips":35,"pct":0.31,"max":1290},{"trips":37,"pct":0.35,"max":1490}]', '2026-07-01')
      ON CONFLICT (parameter, effective_from) DO NOTHING;
    `);
    console.log("Pay config seeded.");
  } finally {
    await pool.end();
  }
}

async function ensurePerformancePermission() {
  // Backfill the new "performance" permission section for every existing user.
  // Mirrors their daily-logs permissions so admins keep admin status (since
  // requireAdmin checks ADMIN_SECTIONS which now includes "performance"),
  // and view/edit-only roles get the equivalent access for performance.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
      SELECT
        dl.user_id,
        'performance' AS section,
        dl.can_view,
        dl.can_create,
        dl.can_edit,
        dl.can_delete
      FROM user_permissions dl
      WHERE dl.section = 'daily-logs'
        AND NOT EXISTS (
          SELECT 1 FROM user_permissions p
          WHERE p.user_id = dl.user_id AND p.section = 'performance'
        );
    `);
    console.log("Performance permission backfilled for existing users.");
  } finally {
    await pool.end();
  }
}

(async () => {
  try {
    await ensureSessionTable();
  } catch (err) {
    console.error("Failed to ensure session table (non-fatal):", err);
  }

  try {
    await ensureSalaryColumns();
  } catch (err) {
    console.error("Failed to ensure salary columns (non-fatal):", err);
  }

  try {
    await ensureExpenseTables();
  } catch (err) {
    console.error("Failed to ensure expense tables (non-fatal):", err);
  }

  try {
    await ensureYangoColumns();
  } catch (err) {
    console.error("Failed to ensure Yango columns (non-fatal):", err);
  }

  try {
    await ensureRiderDayUniqueIndexes();
  } catch (err) {
    console.error("Failed to ensure rider-day unique indexes (non-fatal):", err);
  }

  try {
    await ensureFleetTables();
  } catch (err) {
    console.error("Failed to ensure fleet tables (non-fatal):", err);
  }

  try {
    await ensurePayConfigSeed();
  } catch (err) {
    console.error("Failed to seed pay config (non-fatal):", err);
  }

  try {
    await seedAdmin();
  } catch (err) {
    console.error("Failed to seed admin (non-fatal):", err);
  }

  try {
    await ensurePerformancePermission();
  } catch (err) {
    console.error("Failed to backfill performance permission (non-fatal):", err);
  }

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startDriverCache();
  });
})();
