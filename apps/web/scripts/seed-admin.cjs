/**
 * One-shot: create the first admin user in `next_auth.users` if no row exists yet.
 *
 * Usage (from apps/web):
 *   SEED_ADMIN_EMAIL=you@corp.com SEED_ADMIN_PASSWORD='secure' node scripts/seed-admin.cjs
 *
 * Requires DATABASE_URL and bcrypt-compatible password hashing (same as Auth.js login).
 */
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
} else {
  require("dotenv").config();
}

const bcrypt = require("bcryptjs");
const pg = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMeNow!";
  const name = (process.env.SEED_ADMIN_NAME || "Administrator").trim();

  const pool = new pg.Pool({ connectionString: url });
  try {
    const exists = await pool.query(`SELECT id FROM next_auth.users WHERE email = $1`, [email]);
    if (exists.rowCount > 0) {
      console.info(`User already exists: ${email} — skip seed.`);
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO next_auth.users (id, name, email, "emailVerified", password_hash, role, disabled, must_change_password)
       VALUES (gen_random_uuid(), $1, $2, NOW(), $3, 'admin', false, false)`,
      [name, email, hash],
    );
    console.info(`Created admin user: ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
