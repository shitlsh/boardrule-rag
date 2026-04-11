import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/app-settings";

import { decryptSecret, encryptSecret } from "@/lib/ai-crypto";
import type {
  AiCredentialPublic,
  AiCredentialStored,
  AiGatewayPublic,
  AiGatewayStored,
  AiVendor,
  EngineAiPayloadV2,
  RagOptionsStored,
  SlotBinding,
  SlotKey,
} from "@/lib/ai-gateway-types";
import { isAiVendor } from "@/lib/ai-gateway-types";
import {
  assertValidDashscopeCompatibleBase,
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";

const SLOTS: SlotKey[] = ["flash", "pro", "embed", "chat"];

const DEFAULT_CHAT = { temperature: 0.2, maxTokens: 8192 };

const MAX_HIDDEN_MODEL_IDS = 8000;

function normalizeHiddenModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const u = [
    ...new Set(
      raw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  return u.slice(0, MAX_HIDDEN_MODEL_IDS);
}

function normalizeCredentialFromStored(c: AiCredentialStored): AiCredentialStored {
  const enabled = c.enabled === false ? false : true;
  const hiddenModelIds = normalizeHiddenModelIds(c.hiddenModelIds);
  const next: AiCredentialStored = { ...c, enabled };
  if (hiddenModelIds.length > 0) {
    next.hiddenModelIds = hiddenModelIds;
  } else {
    delete next.hiddenModelIds;
  }
  return next;
}

function clearSlotsReferencingCredential(
  stored: AiGatewayStored,
  credentialId: string,
): AiGatewayStored["slotBindings"] {
  const slotBindings = { ...stored.slotBindings };
  for (const s of SLOTS) {
    const b = slotBindings[s];
    if (b?.credentialId === credentialId) {
      slotBindings[s] = null;
    }
  }
  return slotBindings;
}

function normalizeRagOptions(raw: unknown): RagOptionsStored | undefined {
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: RagOptionsStored = {};
  if (typeof r.rerankModel === "string" && r.rerankModel.trim()) {
    out.rerankModel = r.rerankModel.trim();
  }
  if (typeof r.chunkSize === "number" && Number.isFinite(r.chunkSize) && r.chunkSize > 0) {
    out.chunkSize = Math.trunc(r.chunkSize);
  }
  if (typeof r.chunkOverlap === "number" && Number.isFinite(r.chunkOverlap) && r.chunkOverlap >= 0) {
    out.chunkOverlap = Math.trunc(r.chunkOverlap);
  }
  if (r.bm25TokenProfile === "cjk_char" || r.bm25TokenProfile === "latin_word") {
    out.bm25TokenProfile = r.bm25TokenProfile;
  }
  if (typeof r.similarityTopK === "number" && Number.isFinite(r.similarityTopK) && r.similarityTopK > 0) {
    out.similarityTopK = Math.trunc(r.similarityTopK);
  }
  if (typeof r.rerankTopN === "number" && Number.isFinite(r.rerankTopN) && r.rerankTopN > 0) {
    out.rerankTopN = Math.trunc(r.rerankTopN);
  }
  if (r.retrievalMode === "hybrid" || r.retrievalMode === "vector_only") {
    out.retrievalMode = r.retrievalMode;
  }
  if (typeof r.useRerank === "boolean") {
    out.useRerank = r.useRerank;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function emptyStored(): AiGatewayStored {
  return {
    version: 1,
    credentials: [],
    slotBindings: { flash: null, pro: null, embed: null, chat: null },
    chatOptions: { ...DEFAULT_CHAT },
    ragOptions: {},
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
      ? (o.credentials as AiCredentialStored[]).filter((c) => {
          if (
            !c ||
            typeof c.id !== "string" ||
            typeof c.vendor !== "string" ||
            typeof c.alias !== "string" ||
            typeof c.apiKeyEnc !== "string"
          ) {
            return false;
          }
          return isAiVendor(c.vendor);
        }).map((c) => {
          const base =
            typeof c.dashscopeCompatibleBase === "string" ? c.dashscopeCompatibleBase.trim() : "";
          const merged: AiCredentialStored = {
            ...c,
            ...(c.vendor === "qwen" && base
              ? { dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(base) }
              : {}),
          };
          return normalizeCredentialFromStored(merged);
        })
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
    const ragRaw = (o as { ragOptions?: unknown }).ragOptions;
    const ragOptions = normalizeRagOptions(ragRaw) ?? {};
    const merged: AiGatewayStored = {
      version: 1,
      credentials,
      slotBindings,
      chatOptions,
      ragOptions,
    };
    return migrateChatBindingFromLegacyOptions(merged);
  } catch {
    return emptyStored();
  }
}

function normalizeBinding(v: unknown): SlotBinding | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  const credentialId = typeof b.credentialId === "string" ? b.credentialId.trim() : "";
  const model = typeof b.model === "string" ? b.model.trim() : "";
  if (!credentialId || !model) return null;
  const out: SlotBinding = { credentialId, model };
  if (typeof b.maxOutputTokens === "number" && Number.isFinite(b.maxOutputTokens)) {
    const m = Math.trunc(b.maxOutputTokens);
    if (m > 0) out.maxOutputTokens = m;
  }
  if (typeof b.temperature === "number" && Number.isFinite(b.temperature)) {
    out.temperature = b.temperature;
  }
  if (typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens)) {
    const mt = Math.trunc(b.maxTokens);
    if (mt > 0) out.maxTokens = mt;
  }
  return out;
}

/**
 * Legacy stores had chat params only under `chatOptions`. Copy into `slotBindings.chat`
 * when missing so the slot panel can show a single source of truth.
 */
function migrateChatBindingFromLegacyOptions(stored: AiGatewayStored): AiGatewayStored {
  const ch = stored.slotBindings.chat;
  if (!ch) return stored;
  const needTemp = ch.temperature === undefined;
  const needMt = ch.maxTokens === undefined;
  if (!needTemp && !needMt) return stored;
  return {
    ...stored,
    slotBindings: {
      ...stored.slotBindings,
      chat: {
        ...ch,
        ...(needTemp ? { temperature: stored.chatOptions.temperature } : {}),
        ...(needMt ? { maxTokens: stored.chatOptions.maxTokens } : {}),
      },
    },
  };
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
      enabled: c.enabled !== false,
      hiddenModelIds: c.hiddenModelIds ?? [],
      ...(c.vendor === "qwen"
        ? { dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(c.dashscopeCompatibleBase) }
        : {}),
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
    ragOptions: { ...(stored.ragOptions ?? {}) },
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
    vendor: AiVendor;
    alias: string;
    /** If omitted or empty, keep previous key for this id. */
    apiKey?: string;
    /** When vendor is qwen. */
    dashscopeCompatibleBase?: string;
  }[];
  slotBindings?: Partial<Record<SlotKey, SlotBinding | null>>;
  chatOptions?: Partial<{ temperature: number; maxTokens: number }>;
  ragOptions?: Partial<RagOptionsStored> | null;
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
      if (!isAiVendor(p.vendor)) {
        throw new Error("vendor 必须为 gemini、openrouter 或 qwen");
      }
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
      const inherited =
        prev && (prev.enabled === false || (prev.hiddenModelIds && prev.hiddenModelIds.length > 0))
          ? {
              ...(prev.enabled === false ? { enabled: false as const } : {}),
              ...(prev.hiddenModelIds && prev.hiddenModelIds.length > 0
                ? { hiddenModelIds: [...prev.hiddenModelIds] }
                : {}),
            }
          : {};
      if (p.vendor === "qwen") {
        const raw =
          typeof p.dashscopeCompatibleBase === "string" ? p.dashscopeCompatibleBase.trim() : "";
        const fromPrev =
          prev?.vendor === "qwen" && prev.dashscopeCompatibleBase
            ? prev.dashscopeCompatibleBase
            : "";
        const merged = raw || fromPrev || "";
        assertValidDashscopeCompatibleBase(merged || DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
        next.push(
          normalizeCredentialFromStored({
            ...inherited,
            id: p.id,
            vendor: p.vendor,
            alias,
            apiKeyEnc,
            dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(merged),
          }),
        );
      } else {
        next.push(
          normalizeCredentialFromStored({
            ...inherited,
            id: p.id,
            vendor: p.vendor,
            alias,
            apiKeyEnc,
          }),
        );
      }
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

  let ragOptions: RagOptionsStored | undefined = cur.ragOptions ?? {};
  if (patch.ragOptions !== undefined) {
    if (patch.ragOptions === null) {
      ragOptions = {};
    } else {
      ragOptions = { ...ragOptions, ...patch.ragOptions };
      if (patch.ragOptions.rerankModel === "") {
        const { rerankModel: _r, ...rest } = ragOptions;
        ragOptions = rest;
      }
    }
  }

  const stored: AiGatewayStored = {
    version: 1,
    credentials,
    slotBindings,
    chatOptions,
    ragOptions,
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
): {
  apiKey: string;
  model: string;
  vendor: AiVendor;
  dashscopeCompatibleBase?: string;
} {
  const b = stored.slotBindings[slot];
  if (!b?.credentialId || !b.model?.trim()) {
    throw new Error(`AI 槽位未配置: ${slot}`);
  }
  const cred = stored.credentials.find((c) => c.id === b.credentialId);
  if (!cred) throw new Error(`槽位 ${slot} 引用的凭证不存在`);
  if (cred.enabled === false) {
    throw new Error(`凭证「${cred.alias}」已停用`);
  }
  const apiKey = decryptSecret(cred.apiKeyEnc).trim();
  if (!apiKey) throw new Error(`凭证 ${cred.alias} 的 API Key 无效`);
  const dashscopeCompatibleBase =
    cred.vendor === "qwen"
      ? normalizeDashscopeCompatibleBase(cred.dashscopeCompatibleBase)
      : undefined;
  return { apiKey, model: b.model.trim(), vendor: cred.vendor, dashscopeCompatibleBase };
}

/** Resolved payload for rule_engine (v2). Throws if any slot incomplete. */
export function buildEngineAiPayload(stored: AiGatewayStored): EngineAiPayloadV2 {
  const flash = resolveSlot(stored, "flash");
  const pro = resolveSlot(stored, "pro");
  const embed = resolveSlot(stored, "embed");
  const chat = resolveSlot(stored, "chat");
  const flashB = stored.slotBindings.flash;
  const proB = stored.slotBindings.pro;
  const chatB = stored.slotBindings.chat;
  const temperature = chatB?.temperature ?? stored.chatOptions.temperature;
  const maxTokens = chatB?.maxTokens ?? stored.chatOptions.maxTokens;
  const ro = stored.ragOptions;
  const hasRag =
    ro &&
    ((ro.rerankModel && ro.rerankModel.trim()) ||
      (typeof ro.chunkSize === "number" && Number.isFinite(ro.chunkSize)) ||
      (typeof ro.chunkOverlap === "number" && Number.isFinite(ro.chunkOverlap)) ||
      ro.bm25TokenProfile ||
      (typeof ro.similarityTopK === "number" && Number.isFinite(ro.similarityTopK)) ||
      (typeof ro.rerankTopN === "number" && Number.isFinite(ro.rerankTopN)) ||
      ro.retrievalMode ||
      typeof ro.useRerank === "boolean");
  return {
    version: 2,
    slots: {
      flash: {
        provider: flash.vendor,
        apiKey: flash.apiKey,
        model: flash.model,
        ...(flashB?.maxOutputTokens != null && flashB.maxOutputTokens > 0
          ? { maxOutputTokens: Math.trunc(flashB.maxOutputTokens) }
          : {}),
        ...(flash.vendor === "qwen"
          ? { dashscopeCompatibleBase: flash.dashscopeCompatibleBase }
          : {}),
      },
      pro: {
        provider: pro.vendor,
        apiKey: pro.apiKey,
        model: pro.model,
        ...(proB?.maxOutputTokens != null && proB.maxOutputTokens > 0
          ? { maxOutputTokens: Math.trunc(proB.maxOutputTokens) }
          : {}),
        ...(pro.vendor === "qwen" ? { dashscopeCompatibleBase: pro.dashscopeCompatibleBase } : {}),
      },
      embed: {
        provider: embed.vendor,
        apiKey: embed.apiKey,
        model: embed.model,
        ...(embed.vendor === "qwen"
          ? { dashscopeCompatibleBase: embed.dashscopeCompatibleBase }
          : {}),
      },
      chat: {
        provider: chat.vendor,
        apiKey: chat.apiKey,
        model: chat.model,
        temperature,
        maxTokens,
        ...(chat.vendor === "qwen"
          ? { dashscopeCompatibleBase: chat.dashscopeCompatibleBase }
          : {}),
      },
    },
    ...(hasRag ? { ragOptions: ro } : {}),
  };
}

export async function getEngineAiPayloadOrThrow(): Promise<EngineAiPayloadV2> {
  const stored = await getAiGatewayStored();
  return buildEngineAiPayload(stored);
}

export function getCredentialApiKey(stored: AiGatewayStored, credentialId: string): string {
  const cred = stored.credentials.find((c) => c.id === credentialId);
  if (!cred) throw new Error("凭证不存在");
  return decryptSecret(cred.apiKeyEnc).trim();
}

export function getCredentialVendor(stored: AiGatewayStored, credentialId: string): AiVendor {
  const cred = stored.credentials.find((c) => c.id === credentialId);
  if (!cred) throw new Error("凭证不存在");
  return cred.vendor;
}

export function getStoredCredential(
  stored: AiGatewayStored,
  credentialId: string,
): AiCredentialStored | undefined {
  return stored.credentials.find((c) => c.id === credentialId);
}

/** Resolved DashScope OpenAI-compatible base for a saved Qwen credential. */
export function getCredentialDashscopeCompatibleBase(
  stored: AiGatewayStored,
  credentialId: string,
): string {
  const cred = stored.credentials.find((c) => c.id === credentialId);
  if (!cred) throw new Error("凭证不存在");
  if (cred.vendor !== "qwen") throw new Error("该凭证不是 Qwen（百炼）");
  return normalizeDashscopeCompatibleBase(cred.dashscopeCompatibleBase);
}

async function persistStored(stored: AiGatewayStored): Promise<AiGatewayPublic> {
  await getAppSettings();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { aiGatewayJson: JSON.stringify(stored) },
  });
  return toPublic(stored);
}

/** Add a new API credential (saved immediately). */
export async function addCredential(params: {
  id: string;
  alias: string;
  apiKey: string;
  vendor: AiVendor;
  /** Required for vendor qwen (normalized); defaults to Beijing if omitted. */
  dashscopeCompatibleBase?: string;
}): Promise<AiGatewayPublic> {
  if (!isAiVendor(params.vendor)) {
    throw new Error("vendor 必须为 gemini、openrouter 或 qwen");
  }
  const alias = params.alias.trim();
  const key = params.apiKey.trim();
  if (!alias) throw new Error("别名不能为空");
  if (!key) throw new Error("API Key 不能为空");
  const cur = await getAiGatewayStored();
  const newKey = aliasKey(alias);
  for (const c of cur.credentials) {
    if (aliasKey(c.alias) === newKey) {
      throw new Error("别名已存在");
    }
  }
  if (cur.credentials.some((c) => c.id === params.id)) {
    throw new Error("凭证 ID 冲突");
  }
  let next: AiCredentialStored;
  if (params.vendor === "qwen") {
    const raw = (params.dashscopeCompatibleBase ?? "").trim();
    const merged = raw || DASHSCOPE_COMPATIBLE_BASE_DEFAULT;
    assertValidDashscopeCompatibleBase(merged);
    next = {
      id: params.id,
      vendor: params.vendor,
      alias,
      apiKeyEnc: encryptSecret(key),
      dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(merged),
    };
  } else {
    next = {
      id: params.id,
      vendor: params.vendor,
      alias,
      apiKeyEnc: encryptSecret(key),
    };
  }
  const stored: AiGatewayStored = {
    ...cur,
    credentials: [...cur.credentials, next],
  };
  return persistStored(stored);
}

/** @deprecated Use addCredential */
export async function addGeminiCredential(params: {
  id: string;
  alias: string;
  apiKey: string;
}): Promise<AiGatewayPublic> {
  return addCredential({ ...params, vendor: "gemini" });
}

/** Update alias, vendor, and/or API Key for one credential. */
export async function updateCredential(params: {
  id: string;
  alias?: string;
  vendor?: AiVendor;
  apiKey?: string;
  dashscopeCompatibleBase?: string;
  enabled?: boolean;
  hiddenModelIds?: string[];
}): Promise<AiGatewayPublic> {
  const cur = await getAiGatewayStored();
  const idx = cur.credentials.findIndex((c) => c.id === params.id);
  if (idx < 0) throw new Error("凭证不存在");
  const prev = cur.credentials[idx]!;
  let alias = prev.alias.trim();
  if (params.alias !== undefined) {
    alias = params.alias.trim();
    if (!alias) throw new Error("别名不能为空");
    const nk = aliasKey(alias);
    for (const c of cur.credentials) {
      if (c.id !== params.id && aliasKey(c.alias) === nk) {
        throw new Error("别名已存在");
      }
    }
  }
  let vendor: AiVendor = prev.vendor;
  if (params.vendor !== undefined) {
    if (!isAiVendor(params.vendor)) {
      throw new Error("vendor 必须为 gemini、openrouter 或 qwen");
    }
    vendor = params.vendor;
  }
  let apiKeyEnc = prev.apiKeyEnc;
  if (params.apiKey !== undefined && params.apiKey.trim() !== "") {
    apiKeyEnc = encryptSecret(params.apiKey.trim());
  }

  let dashscopeCompatibleBase: string | undefined;
  if (vendor === "qwen") {
    if (params.dashscopeCompatibleBase !== undefined) {
      const t = params.dashscopeCompatibleBase.trim();
      const merged = t || DASHSCOPE_COMPATIBLE_BASE_DEFAULT;
      assertValidDashscopeCompatibleBase(merged);
      dashscopeCompatibleBase = normalizeDashscopeCompatibleBase(merged);
    } else if (prev.vendor === "qwen" && prev.dashscopeCompatibleBase) {
      dashscopeCompatibleBase = normalizeDashscopeCompatibleBase(prev.dashscopeCompatibleBase);
    } else {
      dashscopeCompatibleBase = normalizeDashscopeCompatibleBase("");
    }
  }

  const nextCred: AiCredentialStored = {
    ...prev,
    id: prev.id,
    vendor,
    alias,
    apiKeyEnc,
  };
  if (vendor === "qwen") {
    nextCred.dashscopeCompatibleBase = dashscopeCompatibleBase!;
  } else {
    delete nextCred.dashscopeCompatibleBase;
  }

  if (params.enabled !== undefined) {
    nextCred.enabled = params.enabled;
  }
  if (params.hiddenModelIds !== undefined) {
    const h = normalizeHiddenModelIds(params.hiddenModelIds);
    if (h.length > 0) {
      nextCred.hiddenModelIds = h;
    } else {
      delete nextCred.hiddenModelIds;
    }
  }

  const credentials = [...cur.credentials];
  credentials[idx] = normalizeCredentialFromStored(nextCred);

  let slotBindings = cur.slotBindings;
  if (params.enabled === false) {
    slotBindings = clearSlotsReferencingCredential(cur, prev.id);
  }

  return persistStored({ ...cur, credentials, slotBindings });
}

/** @deprecated Use updateCredential */
export async function updateGeminiCredential(params: {
  id: string;
  alias?: string;
  apiKey?: string;
}): Promise<AiGatewayPublic> {
  return updateCredential(params);
}

/** Remove credential; clears any slot that referenced it. */
export async function removeCredentialById(id: string): Promise<AiGatewayPublic> {
  const cur = await getAiGatewayStored();
  if (!cur.credentials.some((c) => c.id === id)) {
    throw new Error("凭证不存在");
  }
  const credentials = cur.credentials.filter((c) => c.id !== id);
  const slotBindings = clearSlotsReferencingCredential(cur, id);
  return persistStored({ ...cur, credentials, slotBindings });
}

export type SlotBindingSave =
  | (Omit<SlotBinding, "maxOutputTokens"> & { maxOutputTokens?: number | null })
  | null;

/** Set one slot binding (auto-save). Both parts required when binding is set. */
export async function setSlotBinding(slot: SlotKey, binding: SlotBindingSave): Promise<AiGatewayPublic> {
  if (!SLOTS.includes(slot)) throw new Error("无效槽位");
  const cur = await getAiGatewayStored();
  const credIds = new Set(cur.credentials.map((c) => c.id));
  let nextBinding: SlotBinding | null = null;
  let chatOptions = cur.chatOptions;
  if (binding !== null) {
    const cid = binding.credentialId.trim();
    const model = binding.model.trim();
    if (!cid || !model) throw new Error("请选择凭证并填写模型");
    if (!credIds.has(cid)) throw new Error("凭证不存在");
    const credRow = cur.credentials.find((c) => c.id === cid);
    if (credRow?.enabled === false) {
      throw new Error("凭证已停用，请先在模型管理中启用");
    }
    const base: SlotBinding = { credentialId: cid, model };

    if (slot === "flash" || slot === "pro") {
      const raw = binding.maxOutputTokens as number | null | undefined;
      const hasKey = Object.prototype.hasOwnProperty.call(binding as object, "maxOutputTokens");
      const prevSlot = cur.slotBindings[slot];
      if (hasKey && raw === null) {
        // omit field — use rule-engine default (env / 32768)
      } else if (hasKey && raw !== undefined && raw !== null) {
        const m = Math.trunc(Number(raw));
        if (!Number.isFinite(m) || m < 1) throw new Error("maxOutputTokens 须为正整数");
        base.maxOutputTokens = m;
      } else if (
        !hasKey &&
        prevSlot?.credentialId === cid &&
        prevSlot.model === model &&
        prevSlot.maxOutputTokens != null &&
        prevSlot.maxOutputTokens > 0
      ) {
        base.maxOutputTokens = prevSlot.maxOutputTokens;
      }
    }

    if (slot === "chat") {
      const t =
        binding.temperature !== undefined && Number.isFinite(binding.temperature)
          ? binding.temperature
          : cur.chatOptions.temperature;
      const mtRaw = binding.maxTokens;
      const mt =
        mtRaw !== undefined && mtRaw !== null
          ? Math.trunc(Number(mtRaw))
          : cur.chatOptions.maxTokens;
      if (!Number.isFinite(mt) || mt < 1) throw new Error("maxTokens 无效");
      base.temperature = t;
      base.maxTokens = mt;
      chatOptions = { temperature: t, maxTokens: mt };
    }

    nextBinding = base;
  }
  const slotBindings = { ...cur.slotBindings, [slot]: nextBinding };
  return persistStored({ ...cur, slotBindings, chatOptions });
}

/** PATCH body for RAG options: use `null` on a key to clear it (fall back to rule engine env). */
export type RagOptionsPatch = {
  rerankModel?: string | null;
  chunkSize?: number | null;
  chunkOverlap?: number | null;
  bm25TokenProfile?: "cjk_char" | "latin_word" | null;
  similarityTopK?: number | null;
  rerankTopN?: number | null;
  retrievalMode?: "hybrid" | "vector_only" | null;
  useRerank?: boolean | null;
};

export async function patchGatewayRagOptions(patch: RagOptionsPatch): Promise<AiGatewayPublic> {
  const cur = await getAiGatewayStored();
  let ragOptions: RagOptionsStored = { ...(cur.ragOptions ?? {}) };

  if ("rerankModel" in patch) {
    if (patch.rerankModel === null || patch.rerankModel === "") {
      const { rerankModel: _r, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (typeof patch.rerankModel === "string") {
      ragOptions = { ...ragOptions, rerankModel: patch.rerankModel.trim() };
    }
  }
  if ("chunkSize" in patch) {
    if (patch.chunkSize === null) {
      const { chunkSize: _c, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.chunkSize !== undefined && Number.isFinite(patch.chunkSize)) {
      const n = Math.trunc(patch.chunkSize);
      if (n < 1) throw new Error("chunkSize 无效");
      ragOptions = { ...ragOptions, chunkSize: n };
    }
  }
  if ("chunkOverlap" in patch) {
    if (patch.chunkOverlap === null) {
      const { chunkOverlap: _c, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.chunkOverlap !== undefined && Number.isFinite(patch.chunkOverlap)) {
      const n = Math.trunc(patch.chunkOverlap);
      if (n < 0) throw new Error("chunkOverlap 无效");
      ragOptions = { ...ragOptions, chunkOverlap: n };
    }
  }
  if ("bm25TokenProfile" in patch) {
    if (patch.bm25TokenProfile === null) {
      const { bm25TokenProfile: _b, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.bm25TokenProfile === "cjk_char" || patch.bm25TokenProfile === "latin_word") {
      ragOptions = { ...ragOptions, bm25TokenProfile: patch.bm25TokenProfile };
    }
  }
  if ("similarityTopK" in patch) {
    if (patch.similarityTopK === null) {
      const { similarityTopK: _s, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.similarityTopK !== undefined && Number.isFinite(patch.similarityTopK)) {
      const n = Math.trunc(patch.similarityTopK);
      if (n < 1) throw new Error("similarityTopK 无效");
      ragOptions = { ...ragOptions, similarityTopK: n };
    }
  }
  if ("rerankTopN" in patch) {
    if (patch.rerankTopN === null) {
      const { rerankTopN: _r, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.rerankTopN !== undefined && Number.isFinite(patch.rerankTopN)) {
      const n = Math.trunc(patch.rerankTopN);
      if (n < 1) throw new Error("rerankTopN 无效");
      ragOptions = { ...ragOptions, rerankTopN: n };
    }
  }
  if ("retrievalMode" in patch) {
    if (patch.retrievalMode === null) {
      const { retrievalMode: _r, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (patch.retrievalMode === "hybrid" || patch.retrievalMode === "vector_only") {
      ragOptions = { ...ragOptions, retrievalMode: patch.retrievalMode };
    }
  }
  if ("useRerank" in patch) {
    if (patch.useRerank === null) {
      const { useRerank: _u, ...rest } = ragOptions;
      ragOptions = rest;
    } else if (typeof patch.useRerank === "boolean") {
      ragOptions = { ...ragOptions, useRerank: patch.useRerank };
    }
  }
  return persistStored({ ...cur, ragOptions });
}
