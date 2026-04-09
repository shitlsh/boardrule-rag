import pg from "pg";

const globalForPool = globalThis as unknown as { authPgPool: pg.Pool | undefined };

function createPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
  });
}

/** Shared pool for raw SQL against `next_auth` and scripts. */
export const authPgPool = globalForPool.authPgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForPool.authPgPool = authPgPool;
}
