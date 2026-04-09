/**
 * 绕过 `prisma migrate deploy` 在 multi-schema + 共用 Supabase 库上偶发 P3005：
 * 直接执行 `prisma/migrations/<name>/migration.sql`，再 `prisma migrate resolve --applied` 登记历史。
 *
 * 典型顺序（本地修复）：
 *   npm run db:reset-app-schema
 *   npm run db:apply-migration
 *
 * 环境变量：DATABASE_URL
 */
const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
} else {
  require("dotenv").config();
}

const pg = require("pg");

const MIGRATION_DIR = "20260411120000_consolidated_app_and_next_auth";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const sqlPath = path.join(root, "prisma", "migrations", MIGRATION_DIR, "migration.sql");
  if (!fs.existsSync(sqlPath)) {
    console.error("Missing migration file:", sqlPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");

  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query(sql);
    console.info("Executed migration SQL:", sqlPath);
  } finally {
    c.release();
    await pool.end();
  }

  execSync(`npx prisma migrate resolve --applied "${MIGRATION_DIR}"`, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });
  console.info("Marked migration as applied. Check: npx prisma migrate status");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
