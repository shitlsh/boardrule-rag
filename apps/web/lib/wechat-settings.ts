/**
 * WeChat miniapp config stored in AppSettings.wechatConfigJson.
 *
 * Pattern mirrors ai-gateway.ts: a JSON blob in the singleton AppSettings row,
 * with the AppSecret encrypted via ai-crypto (AES-256-GCM).
 */
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/ai-crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape stored in the DB (AppSecret is always encrypted). */
interface WechatConfigStored {
  appId: string;
  appSecretEnc: string; // encrypted with encryptSecret()
}

/** Public shape returned to the settings UI (never exposes the raw secret). */
export interface WechatConfigPublic {
  appId: string;
  hasSecret: boolean;
  /** Last 4 chars of the plain AppSecret, for display only. */
  secretLast4: string | null;
}

/** Patch body accepted by the settings API. */
export interface WechatConfigPatch {
  appId?: string;
  /** If empty/omitted, keep the current stored secret. */
  appSecret?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseStored(raw: string): WechatConfigStored | null {
  if (!raw || raw === "{}") return null;
  try {
    const j = JSON.parse(raw) as unknown;
    if (typeof j !== "object" || j === null) return null;
    const o = j as Record<string, unknown>;
    if (typeof o.appId !== "string" || typeof o.appSecretEnc !== "string") return null;
    return { appId: o.appId, appSecretEnc: o.appSecretEnc };
  } catch {
    return null;
  }
}

function secretLast4(plain: string): string | null {
  const t = plain.trim();
  if (t.length === 0) return null;
  return t.length <= 4 ? t : t.slice(-4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read the public (safe) representation of the WeChat config. */
export async function getWechatConfigPublic(): Promise<WechatConfigPublic> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const stored = parseStored(row?.wechatConfigJson ?? "{}");

  if (!stored) {
    return { appId: "", hasSecret: false, secretLast4: null };
  }

  let hasSecret = false;
  let last4: string | null = null;
  try {
    const plain = decryptSecret(stored.appSecretEnc);
    hasSecret = plain.trim().length > 0;
    last4 = secretLast4(plain);
  } catch {
    hasSecret = false;
  }

  return { appId: stored.appId, hasSecret, secretLast4: last4 };
}

/**
 * Read the raw AppId + decrypted AppSecret for server-side use (wx-login route).
 * Returns null if not configured.
 */
export async function getWechatCredentials(): Promise<{ appId: string; appSecret: string } | null> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const stored = parseStored(row?.wechatConfigJson ?? "{}");
  if (!stored || !stored.appId) return null;
  try {
    const appSecret = decryptSecret(stored.appSecretEnc).trim();
    if (!appSecret) return null;
    return { appId: stored.appId, appSecret };
  } catch {
    return null;
  }
}

/** Persist updated WeChat config. */
export async function updateWechatConfig(patch: WechatConfigPatch): Promise<WechatConfigPublic> {
  // Ensure the singleton row exists
  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  const row = await prisma.appSettings.findUniqueOrThrow({ where: { id: "default" } });
  const current = parseStored(row.wechatConfigJson ?? "{}");

  // Resolve new appId
  const appId = (patch.appId !== undefined ? patch.appId.trim() : current?.appId ?? "");

  // Resolve new appSecretEnc: encrypt if provided, keep old otherwise
  let appSecretEnc: string;
  if (patch.appSecret !== undefined && patch.appSecret.trim() !== "") {
    appSecretEnc = encryptSecret(patch.appSecret.trim());
  } else if (current?.appSecretEnc) {
    appSecretEnc = current.appSecretEnc;
  } else {
    appSecretEnc = "";
  }

  const stored: WechatConfigStored = { appId, appSecretEnc };

  await prisma.appSettings.update({
    where: { id: "default" },
    data: { wechatConfigJson: JSON.stringify(stored) },
  });

  return getWechatConfigPublic();
}
