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
  EngineAiPayloadV3,
  ExtractionRuntimeOverrides,
  RagOptionsStored,
  SlotBinding,
  SlotKey,
} from "@/lib/ai-gateway-types";
import type { ChatProfileConfigParsed, ExtractionProfileConfigParsed } from "@/lib/ai-runtime-profile-schema";
import { getActiveChatProfileConfig, getFirstExtractionProfileConfig } from "@/lib/ai-runtime-profiles";
import { isAiVendor } from "@/lib/ai-gateway-types";
import {
  assertValidDashscopeCompatibleBase,
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";

/** Credential cleanup / validation: all keys we still store in JSON (non-embed always null). */
const SLOTS: SlotKey[] = ["flash", "pro", "embed", "chat"];

function stripNonEmbedGatewaySlots(
  sb: AiGatewayStored["slotBindings"],
): AiGatewayStored["slotBindings"] {
  return {
    flash: null,
    pro: null,
    embed: sb.embed ?? null,
    chat: null,
  };
}

function rawHasLegacyGatewaySlots(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const sb = o.slotBindings as Record<string, unknown> | undefined;
    if (!sb || typeof sb !== "object") return false;
    for (const k of ["flash", "pro", "chat"] as const) {
      const v = sb[k];
      if (!v || typeof v !== "object") continue;
      const c = (v as { credentialId?: unknown }).credentialId;
      const m = (v as { model?: unknown }).model;
      if (typeof c === "string" && c.trim() && typeof m === "string" && m.trim()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
      slotBindings: stripNonEmbedGatewaySlots(slotBindings),
      chatOptions,
      ragOptions,
    };
    return merged;
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
      flash: null,
      pro: null,
      embed: stored.slotBindings.embed ?? null,
      chat: null,
    },
    chatOptions: { ...stored.chatOptions },
    ragOptions: { ...(stored.ragOptions ?? {}) },
  };
}

export async function getAiGatewayStored(): Promise<AiGatewayStored> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const raw = row?.aiGatewayJson;
  if (raw === undefined || raw === null || raw === "") return emptyStored();
  const stripNeeded = rawHasLegacyGatewaySlots(raw);
  const stored = parseStored(raw);
  if (stripNeeded) {
    await getAppSettings();
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { aiGatewayJson: JSON.stringify(stored) },
    });
  }
  return stored;
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
    const p = patch.slotBindings;
    if (p.flash !== undefined || p.pro !== undefined || p.chat !== undefined) {
      throw new Error("网关已不再保存 Flash / Pro / Chat 槽，请使用「提取模型」与「聊天模型」模版");
    }
    if (p.embed !== undefined) {
      slotBindings = { ...slotBindings, embed: p.embed };
    }
    const b = slotBindings.embed;
    if (b && b.model.trim() && b.credentialId && !credIds.has(b.credentialId)) {
      throw new Error("Embed 槽位引用的凭证不存在");
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
    slotBindings: stripNonEmbedGatewaySlots(slotBindings),
    chatOptions,
    ragOptions,
  };

  const emb = stored.slotBindings.embed;
  if (emb?.credentialId && !credIds.has(emb.credentialId)) {
    throw new Error("Embed 槽位仍引用已删除的凭证");
  }

  await getAppSettings();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { aiGatewayJson: JSON.stringify(stored) },
  });

  return toPublic(stored);
}

/** Resolve a concrete slot binding to API key + model (same rules as named slots). */
export function resolveSlotBinding(
  stored: AiGatewayStored,
  binding: SlotBinding,
  labelForError: string,
): {
  apiKey: string;
  model: string;
  vendor: AiVendor;
  dashscopeCompatibleBase?: string;
} {
  if (!binding.credentialId || !binding.model?.trim()) {
    throw new Error(`${labelForError}：请选择凭证并填写模型`);
  }
  const cred = stored.credentials.find((c) => c.id === binding.credentialId);
  if (!cred) throw new Error(`${labelForError}：引用的凭证不存在`);
  if (cred.enabled === false) {
    throw new Error(`凭证「${cred.alias}」已停用`);
  }
  const apiKey = decryptSecret(cred.apiKeyEnc).trim();
  if (!apiKey) throw new Error(`凭证 ${cred.alias} 的 API Key 无效`);
  const dashscopeCompatibleBase =
    cred.vendor === "qwen"
      ? normalizeDashscopeCompatibleBase(cred.dashscopeCompatibleBase)
      : undefined;
  return { apiKey, model: binding.model.trim(), vendor: cred.vendor, dashscopeCompatibleBase };
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
  return resolveSlotBinding(stored, b, `槽位 ${slot}`);
}

function engineFlashProFromBinding(
  stored: AiGatewayStored,
  binding: SlotBinding,
  labelForError: string,
): EngineAiPayloadV2["slots"]["flash"] {
  const r = resolveSlotBinding(stored, binding, labelForError);
  const mot =
    binding.maxOutputTokens != null && binding.maxOutputTokens > 0
      ? Math.trunc(binding.maxOutputTokens)
      : undefined;
  return {
    provider: r.vendor,
    apiKey: r.apiKey,
    model: r.model,
    ...(mot != null ? { maxOutputTokens: mot } : {}),
    ...(r.vendor === "qwen" ? { dashscopeCompatibleBase: r.dashscopeCompatibleBase } : {}),
  };
}

function engineChatFromBinding(
  stored: AiGatewayStored,
  binding: SlotBinding,
  fallback: { temperature: number; maxTokens: number },
): EngineAiPayloadV2["slots"]["chat"] {
  const r = resolveSlotBinding(stored, binding, "聊天模版 Chat 槽位");
  const temperature = binding.temperature ?? fallback.temperature;
  const maxTokens = binding.maxTokens ?? fallback.maxTokens;
  return {
    provider: r.vendor,
    apiKey: r.apiKey,
    model: r.model,
    temperature,
    maxTokens,
    ...(r.vendor === "qwen" ? { dashscopeCompatibleBase: r.dashscopeCompatibleBase } : {}),
  };
}

function hasRagOptionsContent(ro: RagOptionsStored | undefined): boolean {
  if (!ro) return false;
  return (
    Boolean(ro.rerankModel && ro.rerankModel.trim()) ||
    (typeof ro.chunkSize === "number" && Number.isFinite(ro.chunkSize)) ||
    (typeof ro.chunkOverlap === "number" && Number.isFinite(ro.chunkOverlap)) ||
    ro.bm25TokenProfile != null ||
    (typeof ro.similarityTopK === "number" && Number.isFinite(ro.similarityTopK)) ||
    (typeof ro.rerankTopN === "number" && Number.isFinite(ro.rerankTopN)) ||
    ro.retrievalMode != null ||
    typeof ro.useRerank === "boolean"
  );
}

function engineEmbedSlot(stored: AiGatewayStored): EngineAiPayloadV2["slots"]["embed"] {
  const e = resolveSlot(stored, "embed");
  return {
    provider: e.vendor,
    apiKey: e.apiKey,
    model: e.model,
    ...(e.vendor === "qwen" ? { dashscopeCompatibleBase: e.dashscopeCompatibleBase } : {}),
  };
}

/** Chat slot from the active CHAT profile only (no gateway `slotBindings.chat`). */
function buildChatSlotForPayload(
  stored: AiGatewayStored,
  chatProfile: ChatProfileConfigParsed,
): EngineAiPayloadV2["slots"]["chat"] {
  return engineChatFromBinding(stored, chatProfile.chat, {
    temperature: stored.chatOptions.temperature,
    maxTokens: stored.chatOptions.maxTokens,
  });
}

/**
 * Chat + index: RAG defaults from global gateway only (`stored.ragOptions`, edited on 索引配置页).
 * Coarse flash/pro come from the latest EXTRACTION profile (same rules as extract path).
 */
export async function buildEngineAiPayloadForChatAndIndex(
  stored: AiGatewayStored,
  chatProfile: ChatProfileConfigParsed,
): Promise<EngineAiPayloadV3> {
  const ext = await getFirstExtractionProfileConfig();
  if (!ext) {
    throw new Error(
      "请先在「模型管理 → 提取模型」创建并保存至少一套提取模版（用于 Flash / Pro 基线）。",
    );
  }
  return buildEngineAiPayloadFromExtractionProfile(stored, ext, chatProfile);
}

/**
 * Extract pipeline: v3 payload from this EXTRACTION profile only (no global V2 flash/pro).
 * `chatProfile` is usually the active global chat template (same header as default route).
 */
export function buildEngineAiPayloadFromExtractionProfile(
  stored: AiGatewayStored,
  profile: ExtractionProfileConfigParsed,
  chatProfile: ChatProfileConfigParsed,
): EngineAiPayloadV3 {
  const sb = profile.slotBindings;
  const flashBinding = sb.flashToc ?? sb.flashQuickstart;
  const proBinding = sb.proExtract ?? sb.proMerge;
  if (!flashBinding?.credentialId || !String(flashBinding.model ?? "").trim()) {
    throw new Error("提取模版需至少配置 TOC Flash 或 Quickstart Flash 之一");
  }
  if (!proBinding?.credentialId || !String(proBinding.model ?? "").trim()) {
    throw new Error("提取模版需至少配置 Extract Pro 或 Merge Pro 之一");
  }

  const slotsV3: EngineAiPayloadV3["slots"] = {
    flash: engineFlashProFromBinding(
      stored,
      flashBinding,
      "提取模版 Flash 基线（优先 TOC，否则 Quickstart）",
    ),
    pro: engineFlashProFromBinding(
      stored,
      proBinding,
      "提取模版 Pro 基线（优先章节提取，否则合并）",
    ),
    embed: engineEmbedSlot(stored),
    chat: buildChatSlotForPayload(stored, chatProfile),
  };

  if (sb.flashToc) {
    slotsV3.flashToc = engineFlashProFromBinding(stored, sb.flashToc, "提取模版 Flash（目录）");
  }
  if (sb.flashQuickstart) {
    slotsV3.flashQuickstart = engineFlashProFromBinding(
      stored,
      sb.flashQuickstart,
      "提取模版 Flash（快路径）",
    );
  }
  if (sb.proExtract) {
    slotsV3.proExtract = engineFlashProFromBinding(stored, sb.proExtract, "提取模版 Pro（章节）");
  }
  if (sb.proMerge) {
    slotsV3.proMerge = engineFlashProFromBinding(stored, sb.proMerge, "提取模版 Pro（合并）");
  }

  const extractionRuntime: ExtractionRuntimeOverrides = {
    ...(profile.extractionRuntime ?? {}),
    ...(profile.forceFullPipelineDefault !== undefined
      ? { forceFullPipelineDefault: profile.forceFullPipelineDefault }
      : {}),
  };
  const hasRuntime = Object.keys(extractionRuntime).length > 0;

  const ro = stored.ragOptions;
  const hasRag = hasRagOptionsContent(ro);

  return {
    version: 3,
    slots: slotsV3,
    ...(hasRag && ro ? { ragOptions: ro } : {}),
    ...(hasRuntime ? { extractionRuntime } : {}),
  };
}

export async function getEngineAiPayloadOrThrow(): Promise<EngineAiPayloadV3> {
  const stored = await getAiGatewayStored();
  const chat = await getActiveChatProfileConfig();
  if (!chat) {
    throw new Error(
      "请先在「模型管理 → 聊天模型」创建并选择全局生效的聊天模版（不再使用网关内 Chat 槽）。",
    );
  }
  return buildEngineAiPayloadForChatAndIndex(stored, chat);
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

/**
 * One-time lazy migration: old CHAT profiles stored `ragOptions` in configJson.
 * Merges those into global gateway `ragOptions` and rewrites profiles to `{ chat }` only.
 */
export async function migrateLegacyChatRagFromRuntimeProfiles(): Promise<void> {
  const profiles = await prisma.aiRuntimeProfile.findMany({ where: { kind: "CHAT" } });
  if (profiles.length === 0) return;

  let stored = await getAiGatewayStored();
  const profileUpdates: { id: string; configJson: string }[] = [];

  for (const p of profiles) {
    let data: unknown;
    try {
      data = JSON.parse(p.configJson || "{}");
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    const o = data as Record<string, unknown>;
    const legacyRag = normalizeRagOptions(o.ragOptions);
    if (!legacyRag || Object.keys(legacyRag).length === 0) continue;

    stored = {
      ...stored,
      ragOptions: { ...(stored.ragOptions ?? {}), ...legacyRag },
    };
    const chat = o.chat;
    if (chat && typeof chat === "object") {
      profileUpdates.push({
        id: p.id,
        configJson: JSON.stringify({ chat }),
      });
    }
  }

  if (profileUpdates.length === 0) return;

  await getAppSettings();
  await prisma.$transaction([
    prisma.appSettings.update({
      where: { id: "default" },
      data: { aiGatewayJson: JSON.stringify(stored) },
    }),
    ...profileUpdates.map((u) =>
      prisma.aiRuntimeProfile.update({
        where: { id: u.id },
        data: { configJson: u.configJson },
      }),
    ),
  ]);
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

/** Set the embed slot only (Flash/Pro/Chat live in runtime profiles, not gateway JSON). */
export async function setSlotBinding(slot: SlotKey, binding: SlotBindingSave): Promise<AiGatewayPublic> {
  if (slot !== "embed") {
    throw new Error("网关仅持久化 Embed 槽；对话在「聊天模型」、提取在「提取模型」中配置。");
  }
  const cur = await getAiGatewayStored();
  const credIds = new Set(cur.credentials.map((c) => c.id));
  let nextBinding: SlotBinding | null = null;
  if (binding !== null) {
    const cid = binding.credentialId.trim();
    const model = binding.model.trim();
    if (!cid || !model) throw new Error("请选择凭证并填写模型");
    if (!credIds.has(cid)) throw new Error("凭证不存在");
    const credRow = cur.credentials.find((c) => c.id === cid);
    if (credRow?.enabled === false) {
      throw new Error("凭证已停用，请先在模型管理中启用");
    }
    nextBinding = { credentialId: cid, model };
  }
  const slotBindings = stripNonEmbedGatewaySlots({
    ...cur.slotBindings,
    embed: nextBinding,
  });
  return persistStored({ ...cur, slotBindings });
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
