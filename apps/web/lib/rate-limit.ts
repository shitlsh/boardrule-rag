/**
 * C-end daily chat limits in Postgres (RateLimit table).
 *
 * Keys:
 * - Per IP: `ip:{normalized_ip}:{YYYY-MM-DD}` (UTC)
 * - Global: `global:c_end:{YYYY-MM-DD}` (UTC) — all miniapp /chat requests combined
 *
 * IP 与全站在同一事务内递增：先 IP 后全站；任一超限则整笔回滚。
 */
import { prisma } from "@/lib/prisma";

export type RateLimitResult =
  | { allowed: true; count: number; remaining: number; limit: number }
  | { allowed: false; limit: number; message: string };

/** Thrown when per-IP or global daily cap is exceeded (message is user-facing). */
export class MiniappChatRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiniappChatRateLimitError";
  }
}

function nextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically increment per-IP and global counters when under limits.
 * `perIpLimit === 0` skips IP; `globalLimit === 0` skips global.
 * Missing client IP skips only the IP bucket (global still applies).
 */
export async function checkAndIncrementMiniappChatLimits(
  normalizedClientIp: string | null,
  perIpLimit: number,
  globalLimit: number,
): Promise<void> {
  if (perIpLimit === 0 && globalLimit === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const d = todayUTC();
    const exp = nextMidnightUTC();

    if (perIpLimit > 0 && normalizedClientIp) {
      const iKey = `ip:${normalizedClientIp}:${d}`;
      const ipRow = await tx.rateLimit.findUnique({ where: { id: iKey } });
      if (!ipRow) {
        await tx.rateLimit.create({
          data: { id: iKey, count: 1, expiresAt: exp },
        });
      } else if (ipRow.count >= perIpLimit) {
        throw new MiniappChatRateLimitError(
          `今日提问次数（${perIpLimit} 次）已用完，明天再来吧`,
        );
      } else {
        await tx.rateLimit.update({
          where: { id: iKey },
          data: { count: { increment: 1 }, expiresAt: exp },
        });
      }
    }

    if (globalLimit > 0) {
      const gKey = `global:c_end:${d}`;
      const gRow = await tx.rateLimit.findUnique({ where: { id: gKey } });
      if (!gRow) {
        await tx.rateLimit.create({
          data: { id: gKey, count: 1, expiresAt: exp },
        });
      } else if (gRow.count >= globalLimit) {
        throw new MiniappChatRateLimitError(
          `今日全站对话次数已达上限（${globalLimit} 次），请明天再试`,
        );
      } else {
        await tx.rateLimit.update({
          where: { id: gKey },
          data: { count: { increment: 1 }, expiresAt: exp },
        });
      }
    }
  });
}

/**
 * @deprecated Legacy single-bucket helper; kept for tests or scripts. Prefer checkAndIncrementMiniappChatLimits.
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

export async function purgeExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
