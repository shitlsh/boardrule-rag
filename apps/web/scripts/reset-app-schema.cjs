/**
 * 1) 删除 `public._prisma_migrations`（若存在）
 * 2) `DROP SCHEMA app CASCADE` —— **不**再 `CREATE SCHEMA app`（空 schema 仍可能触发 migrate deploy 的 P3005）
 *
 * 下一步请用 `npm run db:apply-migration` 执行迁移 SQL 并 `migrate resolve`，或自行 `migrate deploy`。
 *
 * 用法（在 apps/web 下）：
 *   npm run db:reset-app-schema
 *   npx prisma migrate deploy
 *
 * 环境变量：DATABASE_URL（与 .env 一致）
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

const pg = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query('DROP TABLE IF EXISTS public."_prisma_migrations" CASCADE');
    await c.query('DROP SCHEMA IF EXISTS app CASCADE');
    await c.query("COMMIT");
    console.info(
      'Dropped public._prisma_migrations (if any) and schema "app". Next: npm run db:apply-migration',
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
