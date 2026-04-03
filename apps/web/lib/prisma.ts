import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const log =
    process.env.NODE_ENV === "development" ? (["error", "warn"] as const) : (["error"] as const);

  if (url.startsWith("file:")) {
    throw new Error(
      "Prisma schema uses provider `postgresql`, but DATABASE_URL is SQLite (file:...). " +
        "They cannot be mixed. Run `supabase start` and set DATABASE_URL to the Postgres URL from " +
        "`supabase status` — see apps/web/.env.example.",
    );
  }

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    const pool = new pg.Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter, log: [...log] });
  }

  throw new Error(
    `Unsupported DATABASE_URL (must start with postgresql:// or postgres://). Got: ${url.slice(0, 32)}...`,
  );
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
