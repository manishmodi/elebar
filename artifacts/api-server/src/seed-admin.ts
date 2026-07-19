import { db, usersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const SECTIONS = [
  "dashboard",
  "daily-logs",
  "vehicles",
  "riders",
  "salary",
  "assignments",
  "attendance",
  "maintenance",
  "financials",
  "reports",
  "expenses",
  "cash-collection",
  "performance",
];

export async function seedAdmin() {
  const client = await pool.connect();
  try {
    // Drop legacy check constraint (idempotent — safe to run every startup)
    await client.query(
      "ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS section_check"
    );

    // Ensure admin user exists
    let adminId: number;
    const existingRes = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE email = 'admin@elebhar.com' LIMIT 1"
    );

    if (existingRes.rows.length === 0) {
      const passwordHash = await bcrypt.hash("Admin@1234", 10);
      const insertRes = await client.query<{ id: number }>(
        "INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
        ["System Admin", "admin@elebhar.com", passwordHash]
      );
      adminId = insertRes.rows[0].id;
      console.log(`Admin user created: admin@elebhar.com (id: ${adminId})`);
    } else {
      adminId = existingRes.rows[0].id;
      console.log(`Admin user exists (id: ${adminId}), ensuring permissions are up to date.`);
    }

    // Upsert all permissions atomically — one statement per section
    // ON CONFLICT uses the unique constraint (user_id, section)
    for (const section of SECTIONS) {
      await client.query(
        `INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
         VALUES ($1, $2, true, true, true, true)
         ON CONFLICT (user_id, section)
         DO UPDATE SET can_view = true, can_create = true, can_edit = true, can_delete = true`,
        [adminId, section]
      );
    }

    console.log(`Admin permissions ensured for ${SECTIONS.length} sections.`);
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("seed-admin.ts") || process.argv[1]?.endsWith("seed-admin.js")) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
