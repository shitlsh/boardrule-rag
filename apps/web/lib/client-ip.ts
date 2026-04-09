/**
 * Client IP for rate limiting behind Vercel / proxies.
 * Prefer the leftmost address in X-Forwarded-For (original client on Vercel).
 */
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return normalizeIpForRateLimitKey(first);
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return normalizeIpForRateLimitKey(realIp);
  return null;
}

/** Stable string for DB keys: lowercase, strip IPv6 zone id (e.g. fe80::1%eth0). */
export function normalizeIpForRateLimitKey(ip: string): string {
  const t = ip.trim();
  const z = t.indexOf("%");
  const base = z >= 0 ? t.slice(0, z) : t;
  return base.toLowerCase();
}
