import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/app-settings";

import { decryptSecret, encryptSecret } from "@/lib/ai-crypto";
import type {
  AiCredentialPublic,
  AiCredentialStored,
  AiGatewayPublic,
  AiGatewayStored,
  EngineAiPayloadV1,
  SlotBinding,
  SlotKey,
} from "@/lib/ai-gateway-types";

const SLOTS: SlotKey[] = ["flash", "pro", "embed", "chat"];

const DEFAULT_CHAT = { temperature: 0.2, maxTokens: 8192 };

function emptyStored(): AiGatewayStored {
  return {
    version: 1,
    credentials: [],
    slotBindings: { flash: null, pro: null, embed: null, chat: null },
    chatOptions: { ...DEFAULT_CHAT },
  };
}

function parseStored(raw: string): AiGatewayStored {
  if (!raw || raw === "{}") return emptyStored();
  try {
    const j = JSON.parse(raw) as unknown;
    if (typeof j !== "object" || j === null) return emptyStored();
    const o = j as Record<string, unknown>;
    if (o.version !== 1) return emptyStored();
    const credentials = Array.isArray(o.credentials)
      ? (o.credentials as AiCredentialStored[]).filter(
          (c) =>
            c &&
            typeof c.id === "string" &&
            typeof c.vendor === "string" &&
            typeof c.alias === "string" &&
            typeof c.apiKeyEnc === "string",
        )
      : [];
    const sb = (o.slotBindings || {}) as Record<string, unknown>;
    const slotBindings: AiGatewayStored["slotBindings"] = {
      flash: normalizeBinding(sb.flash),
      pro: normalizeBinding(sb.pro),
      embed: normalizeBinding(sb.embed),
      chat: normalizeBinding(sb.chat),
    };
    const co = o.chatOptions as { temperature?: unknown; maxTokens?: unknown } | undefined;
    const chatOptions = {
      temperature:
        typeof co?.temperature === "number" && Number.isFinite(co.temperature)
          ? co.temperature
          : DEFAULT_CHAT.temperature,
      maxTokens:
        typeof co?.maxTokens === "number" && Number.isFinite(co.maxTokens) && co.maxTokens > 0
          ? Math.trunc(co.maxTokens)
          : DEFAULT_CHAT.maxTokens,
    };
    return { version: 1, credentials, slotBindings, chatOptions };
  } catch {
    return emptyStored();
  }
}

function normalizeBinding(v: unknown): SlotBinding | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as { credentialId?: unknown; model?: unknown };
  const credentialId = typeof b.credentialId === "string" ? b.credentialId.trim() : "";
  const model = typeof b.model === "string" ? b.model.trim() : "";
  if (!credentialId || !model) return null;
  return { credentialId, model };
}

export function aliasKey(alias: string): string {
  return alias.trim().toLowerCase();
}

function keyLast4(key: string): string | null {
  const t = key.trim();
  if (t.length < 4) return t.length > 0 ? t : null;
  return t.slice(-4);
}

export function toPublic(stored: AiGatewayStored): AiGatewayPublic {
  const credentials: AiCredentialPublic[] = stored.credentials.map((c) => {
    let hasKey = false;
    let last4: string | null = null;
    try {
      const plain = decryptSecret(c.apiKeyEnc);
      hasKey = plain.length > 0;
      last4 = keyLast4(plain);
    } catch {
      hasKey = false;
    }
    return {
      id: c.id,
      vendor: c.vendor,
      alias: c.alias.trim(),
      hasKey,
      keyLast4: last4,
    };
  });
  return {
    version: 1,
    credentials,
    slotBindings: {
      flash: stored.slotBindings.flash ?? null,
      pro: stored.slotBindings.pro ?? null,
      embed: stored.slotBindings.embed ?? null,
      chat: stored.slotBindings.chat ?? null,
    },
    chatOptions: { ...stored.chatOptions },
  };
}

export async function getAiGatewayStored(): Promise<AiGatewayStored> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const raw = row?.aiGatewayJson;
  if (raw === undefined || raw === null || raw === "") return emptyStored();
  return parseStored(raw);
}

export async function getAiGatewayPublic(): Promise<AiGatewayPublic> {
  return toPublic(await getAiGatewayStored());
}

export type AiGatewayPatchBody = {
  credentials?: {
    id: string;
    vendor: "gemini";
    alias: string;
    /** If omitted or empty, keep previous key for this id. */
    apiKey?: string;
  }[];
  slotBindings?: Partial<Record<SlotKey, SlotBinding | null>>;
  chatOptions?: Partial<{ temperature: number; maxTokens: number }>;
};

function validateCredentialsUniqueAliases(next: { alias: string }[]): void {
  const keys = next.map((c) => aliasKey(c.alias));
  for (const k of keys) {
    if (!k) throw new Error("别名不能为空");
  }
  const uniq = new Set(keys);
  if (uniq.size !== keys.length) {
    throw new Error("别名必须全局唯一（不区分大小写）");
  }
}

export async function updateAiGatewayFromPatch(patch: AiGatewayPatchBody): Promise<AiGatewayPublic> {
  const cur = await getAiGatewayStored();
  const prevById = new Map(cur.credentials.map((c) => [c.id, c]));

  let credentials = cur.credentials;
  if (patch.credentials !== undefined) {
    validateCredentialsUniqueAliases(patch.credentials);
    const next: AiCredentialStored[] = [];
    for (const p of patch.credentials) {
      if (p.vendor !== "gemini") throw new Error("当前仅支持 gemini 厂商");
      const alias = p.alias.trim();
      if (!alias) throw new Error("别名不能为空");
      const prev = prevById.get(p.id);
      let apiKeyEnc: string;
      if (p.apiKey !== undefined && p.apiKey.trim() !== "") {
        apiKeyEnc = encryptSecret(p.apiKey.trim());
      } else if (prev) {
        apiKeyEnc = prev.apiKeyEnc;
      } else {
        throw new Error(`新凭证 ${alias} 必须提供 API Key`);
      }
      next.push({ id: p.id, vendor: "gemini", alias, apiKeyEnc });
    }
    credentials = next;
  }

  const credIds = new Set(credentials.map((c) => c.id));
  let slotBindings = { ...cur.slotBindings };
  if (patch.slotBindings !== undefined) {
    slotBindings = { ...slotBindings, ...patch.slotBindings };
    for (const s of SLOTS) {
      const b = slotBindings[s];
      if (b && b.model.trim() && b.credentialId) {
        if (!credIds.has(b.credentialId)) {
          throw new Error(`槽位 ${s} 引用的凭证不存在`);
        }
      }
    }
  }

  const chatOptions = { ...cur.chatOptions };
  if (patch.chatOptions) {
    if (patch.chatOptions.temperature !== undefined) {
      if (!Number.isFinite(patch.chatOptions.temperature)) throw new Error("chat temperature 无效");
      chatOptions.temperature = patch.chatOptions.temperature;
    }
    if (patch.chatOptions.maxTokens !== undefined) {
      const m = Math.trunc(patch.chatOptions.maxTokens);
      if (m < 1) throw new Error("chat maxTokens 无效");
      chatOptions.maxTokens = m;
    }
  }

  const stored: AiGatewayStored = {
    version: 1,
    credentials,
    slotBindings,
    chatOptions,
  };

  for (const s of SLOTS) {
    const b = stored.slotBindings[s];
    if (b?.credentialId && !credIds.has(b.credentialId)) {
      throw new Error(`槽位 ${s} 仍引用已删除的凭证`);
    }
  }

  await getAppSettings();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { aiGatewayJson: JSON.stringify(stored) },
  });

  return toPublic(stored);
}

function resolveSlot(
  stored: AiGatewayStored,
  slot: SlotKey,
): { apiKey: string; model: string } {
  const b = stored.slotBindings[slot];
  if (!b?.credentialId || !b.model?.trim()) {
    throw new Error(`AI 槽位未配置: ${slot}`);
  }
  const cred = stored.credentials.find((c) => c.id === b.credentialId);
  if (!cred) throw new Error(`槽位 ${slot} 引用的凭证不存在`);
  const apiKey = decryptSecret(cred.apiKeyEnc).trim();
  if (!apiKey) throw new Error(`凭证 ${cred.alias} 的 API Key 无效`);
  return { apiKey, model: b.model.trim() };
}

/** Resolved payload for rule_engine. Throws if any slot incomplete. */
export function buildEngineAiPayload(stored: AiGatewayStored): EngineAiPayloadV1 {
  const flash = resolveSlot(stored, "flash");
  const pro = resolveSlot(stored, "pro");
  const embed = resolveSlot(stored, "embed");
  const chat = resolveSlot(stored, "chat");
  const { temperature, maxTokens } = stored.chatOptions;
  return {
    version: 1,
    gemini: {
      flash: { apiKey: flash.apiKey, model: flash.model, maxOutputTokens: 8192 },
      pro: { apiKey: pro.apiKey, model: pro.model, maxOutputTokens: 8192 },
      embed: { apiKey: embed.apiKey, model: embed.model },
      chat: {
        apiKey: chat.apiKey,
        model: chat.model,
        temperature,
        maxTokens,
      },
    },
  };
}

export async function getEngineAiPayloadOrThrow(): Promise<EngineAiPayloadV1> {
  const stored = await getAiGatewayStored();
  return buildEngineAiPayload(stored);
}

export function getCredentialApiKey(stored: AiGatewayStored, credentialId: string): string {
  const cred = stored.credentials.find((c) => c.id === credentialId);
  if (!cred) throw new Error("凭证不存在");
  return decryptSecret(cred.apiKeyEnc).trim();
}
