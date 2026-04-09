/**
 * Per-IP daily chat rate limiter backed by Postgres (RateLimit table).
 *
 * Key format: "ip:{normalized_ip}:{YYYY-MM-DD}" (UTC date).
 * Uses a single upsert per request — safe under concurrent calls because
 * Postgres serialises the UPDATE on an existing row.
 */
import { prisma } from "@/lib/prisma";

export type RateLimitResult =
  | { allowed: true; count: number; remaining: number; limit: number }
  | { allowed: false; limit: number; message: string };

/** Midnight UTC of the next calendar day — the natural expiry for a daily window. */
function nextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

/** Today's date string in UTC, e.g. "2026-04-08". */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check and increment the rate limit counter for a client IP (already normalized).
 * If limit === 0, always returns allowed (unlimited).
 */
export async function checkAndIncrementChatLimit(
  normalizedClientIp: string,
  limit: number,
): Promise<RateLimitResult> {
  if (limit === 0) {
    return { allowed: true, count: 0, remaining: Infinity, limit: 0 };
  }

  const key = `ip:${normalizedClientIp}:${todayUTC()}`;
  const expiresAt = nextMidnightUTC();

  const existing = await prisma.rateLimit.findUnique({ where: { id: key } });

  if (!existing) {
    await prisma.rateLimit.create({
      data: { id: key, count: 1, expiresAt },
    });
    return { allowed: true, count: 1, remaining: limit - 1, limit };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      message: `今日提问次数（${limit} 次）已用完，明天再来吧`,
    };
  }

  const updated = await prisma.rateLimit.update({
    where: { id: key },
    data: { count: { increment: 1 }, expiresAt },
  });

  return {
    allowed: true,
    count: updated.count,
    remaining: limit - updated.count,
    limit,
  };
}

/**
 * Purge expired RateLimit rows (call from a maintenance cron or on-demand).
 * Returns the number of deleted rows.
 */
export async function purgeExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
