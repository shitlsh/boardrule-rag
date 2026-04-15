import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/app-settings";

import { decryptSecret, encryptSecret } from "@/lib/ai-crypto";
import type {
  AiCredentialPublic,
  AiCredentialStored,
  AiGatewayPublic,
  AiGatewayStored,
  AiVendor,
  BedrockAuthMode,
  EngineAiPayloadV2,
  EngineAiPayloadV3,
  EngineRerankSlot,
  ExtractionRuntimeOverrides,
  RagOptionsStored,
  SlotBinding,
} from "@/lib/ai-gateway-types";
import type {
  ChatProfileConfigParsed,
  ExtractionProfileConfigParsed,
  IndexProfileConfigParsed,
} from "@/lib/ai-runtime-profile-schema";
import {
  getActiveChatProfileConfig,
  getActiveIndexProfileConfig,
  getFirstExtractionProfileConfig,
} from "@/lib/ai-runtime-profiles";
import { INDEX_RAG_DEFAULTS } from "@/lib/rule-engine-defaults";
import { isAiVendor } from "@/lib/ai-gateway-types";
import {
  assertValidDashscopeCompatibleBase,
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";
import {
  assertBedrockCredentialComplete,
  bedrockKeyLast4FromPlain,
  encryptBedrockApiKeyEnc,
  isBedrockIamPayload,
  parseBedrockIamPayload,
} from "@/lib/bedrock-credential";

/** Global chat defaults when a CHAT template omits temperature/maxTokens. Prefer a higher cap for RAG (system + retrieval + answer). */
const DEFAULT_CHAT = { temperature: 0.2, maxTokens: 16384 };

/** Rewrite DB row once after removing legacy `slotBindings` / `ragOptions` from gateway JSON. */
function shouldRewriteGatewayJsonToSlim(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return o.slotBindings !== undefined || o.ragOptions !== undefined;
  } catch {
    return false;
  }
}

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

function emptyStored(): AiGatewayStored {
  return {
    version: 1,
    credentials: [],
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
          const region =
            typeof c.bedrockRegion === "string" ? c.bedrockRegion.trim() : "";
          const merged: AiCredentialStored = {
            ...c,
            ...(c.vendor === "qwen" && base
              ? { dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(base) }
              : {}),
            ...(c.vendor === "bedrock" && region ? { bedrockRegion: region } : {}),
            ...(c.vendor === "bedrock" &&
            (c.bedrockAuthMode === "iam" || c.bedrockAuthMode === "api_key")
              ? { bedrockAuthMode: c.bedrockAuthMode }
              : {}),
          };
          return normalizeCredentialFromStored(merged);
        })
      : [];
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
    const merged: AiGatewayStored = {
      version: 1,
      credentials,
      chatOptions,
    };
    return merged;
  } catch {
    return emptyStored();
  }
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
      last4 =
        c.vendor === "bedrock" ? bedrockKeyLast4FromPlain(plain) : keyLast4(plain);
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
      ...(c.vendor === "bedrock"
        ? {
            ...(c.bedrockRegion?.trim() ? { bedrockRegion: c.bedrockRegion.trim() } : {}),
            ...(c.bedrockAuthMode ? { bedrockAuthMode: c.bedrockAuthMode } : {}),
          }
        : {}),
    };
  });
  return {
    version: 1,
    credentials,
    chatOptions: { ...stored.chatOptions },
  };
}

export async function getAiGatewayStored(): Promise<AiGatewayStored> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const raw = row?.aiGatewayJson;
  if (raw === undefined || raw === null || raw === "") return emptyStored();
  const stored = parseStored(raw);
  if (shouldRewriteGatewayJsonToSlim(String(raw))) {
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
      if (!isAiVendor(p.vendor)) {
        throw new Error("vendor 必须为 gemini、openrouter、qwen、bedrock、claude 或 jina");
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
    chatOptions,
  };

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
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  awsAccessKeyId?: string;
  awsSessionToken?: string;
} {
  if (!binding.credentialId || !binding.model?.trim()) {
    throw new Error(`${labelForError}：请选择凭证并填写模型`);
  }
  const cred = stored.credentials.find((c) => c.id === binding.credentialId);
  if (!cred) throw new Error(`${labelForError}：引用的凭证不存在`);
  if (cred.enabled === false) {
    throw new Error(`凭证「${cred.alias}」已停用`);
  }
  const plain = decryptSecret(cred.apiKeyEnc).trim();
  if (!plain) throw new Error(`凭证 ${cred.alias} 的 API Key 无效`);
  const dashscopeCompatibleBase =
    cred.vendor === "qwen"
      ? normalizeDashscopeCompatibleBase(cred.dashscopeCompatibleBase)
      : undefined;
  if (cred.vendor === "bedrock") {
    assertBedrockCredentialComplete(cred);
    const region = (cred.bedrockRegion ?? "").trim();
    const mode = cred.bedrockAuthMode!;
    if (mode === "api_key") {
      return {
        apiKey: plain,
        model: binding.model.trim(),
        vendor: "bedrock",
        bedrockRegion: region,
        bedrockAuthMode: "api_key",
      };
    }
    if (!isBedrockIamPayload(plain)) {
      throw new Error(`凭证 ${cred.alias} 的 Bedrock IAM 密钥格式无效`);
    }
    const iam = parseBedrockIamPayload(plain);
    return {
      apiKey: iam.secretAccessKey,
      model: binding.model.trim(),
      vendor: "bedrock",
      bedrockRegion: region,
      bedrockAuthMode: "iam",
      awsAccessKeyId: iam.accessKeyId,
      ...(iam.sessionToken ? { awsSessionToken: iam.sessionToken } : {}),
    };
  }
  return { apiKey: plain, model: binding.model.trim(), vendor: cred.vendor, dashscopeCompatibleBase };
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
    ...(r.vendor === "bedrock"
      ? {
          bedrockRegion: r.bedrockRegion,
          bedrockAuthMode: r.bedrockAuthMode,
          ...(r.bedrockAuthMode === "iam"
            ? {
                awsAccessKeyId: r.awsAccessKeyId,
                ...(r.awsSessionToken ? { awsSessionToken: r.awsSessionToken } : {}),
              }
            : {}),
        }
      : {}),
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
    ...(r.vendor === "bedrock"
      ? {
          bedrockRegion: r.bedrockRegion,
          bedrockAuthMode: r.bedrockAuthMode,
          ...(r.bedrockAuthMode === "iam"
            ? {
                awsAccessKeyId: r.awsAccessKeyId,
                ...(r.awsSessionToken ? { awsSessionToken: r.awsSessionToken } : {}),
              }
            : {}),
        }
      : {}),
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

function engineEmbedFromBinding(
  stored: AiGatewayStored,
  binding: SlotBinding,
  labelForError: string,
): EngineAiPayloadV2["slots"]["embed"] {
  const r = resolveSlotBinding(stored, binding, labelForError);
  return {
    provider: r.vendor,
    apiKey: r.apiKey,
    model: r.model,
    ...(r.vendor === "qwen" ? { dashscopeCompatibleBase: r.dashscopeCompatibleBase } : {}),
    ...(r.vendor === "bedrock"
      ? {
          bedrockRegion: r.bedrockRegion,
          bedrockAuthMode: r.bedrockAuthMode,
          ...(r.bedrockAuthMode === "iam"
            ? {
                awsAccessKeyId: r.awsAccessKeyId,
                ...(r.awsSessionToken ? { awsSessionToken: r.awsSessionToken } : {}),
              }
            : {}),
        }
      : {}),
  };
}

function engineRerankFromIndexProfile(stored: AiGatewayStored, index: IndexProfileConfigParsed): EngineRerankSlot {
  const r = index.rerank;
  if (r?.backend === "jina") {
    const key = getCredentialApiKey(stored, r.credentialId);
    return { backend: "jina", apiKey: key, model: r.model.trim() };
  }
  if (r?.backend === "local") {
    return { backend: "local", model: r.model.trim() };
  }
  const legacy = index.ragOptions?.rerankModel?.trim();
  if (legacy) {
    return { backend: "local", model: legacy };
  }
  return { backend: "local", model: INDEX_RAG_DEFAULTS.rerankModel };
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
 * Chat + index: embed + ragOptions from INDEX profile; flash/pro from latest EXTRACTION profile.
 */
export async function buildEngineAiPayloadForChatAndIndex(
  stored: AiGatewayStored,
  chatProfile: ChatProfileConfigParsed,
  indexProfile: IndexProfileConfigParsed,
): Promise<EngineAiPayloadV3> {
  const ext = await getFirstExtractionProfileConfig();
  if (!ext) {
    throw new Error(
      "请先在「模型管理 → 提取模型」创建并保存至少一套提取模版（用于 Flash / Pro 基线）。",
    );
  }
  return buildEngineAiPayloadFromExtractionProfile(stored, ext, chatProfile, indexProfile);
}

/**
 * Extract pipeline: v3 payload from this EXTRACTION profile only (no global V2 flash/pro).
 * `chatProfile` is usually the active global chat template (same header as default route).
 */
export function buildEngineAiPayloadFromExtractionProfile(
  stored: AiGatewayStored,
  profile: ExtractionProfileConfigParsed,
  chatProfile: ChatProfileConfigParsed,
  indexProfile: IndexProfileConfigParsed,
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
    embed: engineEmbedFromBinding(stored, indexProfile.embed, "索引模版 Embed"),
    chat: buildChatSlotForPayload(stored, chatProfile),
    rerank: engineRerankFromIndexProfile(stored, indexProfile),
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

  const ro = indexProfile.ragOptions;
  const hasRag = hasRagOptionsContent(ro);

  const rc = chatProfile.ragChat;
  const chatRag = {
    maxPriorTurns: rc?.maxPriorTurns ?? 3,
    skipCondenseMinChars: rc?.skipCondenseMinChars ?? 15,
  };

  return {
    version: 3,
    slots: slotsV3,
    ...(hasRag && ro ? { ragOptions: ro } : {}),
    ...(hasRuntime ? { extractionRuntime } : {}),
    chatRag,
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
  const indexProfile = await getActiveIndexProfileConfig();
  if (!indexProfile) {
    throw new Error("请先在「模型管理 → 索引配置」创建并选择索引模版（Embed + 检索参数）。");
  }
  return buildEngineAiPayloadForChatAndIndex(stored, chat, indexProfile);
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
  /** vendor bedrock */
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  /** IAM only */
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  bedrockSessionToken?: string;
}): Promise<AiGatewayPublic> {
  if (!isAiVendor(params.vendor)) {
    throw new Error("vendor 必须为 gemini、openrouter、qwen、bedrock、claude 或 jina");
  }
  const alias = params.alias.trim();
  if (!alias) throw new Error("别名不能为空");
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
    const key = params.apiKey.trim();
    if (!key) throw new Error("API Key 不能为空");
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
  } else if (params.vendor === "bedrock") {
    const region = (params.bedrockRegion ?? "").trim();
    const mode = params.bedrockAuthMode;
    if (!region) throw new Error("Bedrock 区域不能为空");
    if (mode !== "iam" && mode !== "api_key") {
      throw new Error("Bedrock 认证方式须为 iam 或 api_key");
    }
    let apiKeyEnc: string;
    if (mode === "api_key") {
      const k = params.apiKey.trim();
      if (!k) throw new Error("Bedrock API Key 不能为空");
      apiKeyEnc = encryptBedrockApiKeyEnc("api_key", { apiKey: k });
    } else {
      const ak = (params.bedrockAccessKeyId ?? "").trim();
      const sk = (params.bedrockSecretAccessKey ?? "").trim();
      if (!ak || !sk) throw new Error("Bedrock IAM 需要 Access Key ID 与 Secret Access Key");
      apiKeyEnc = encryptBedrockApiKeyEnc("iam", {
        accessKeyId: ak,
        secretAccessKey: sk,
        sessionToken: (params.bedrockSessionToken ?? "").trim() || undefined,
      });
    }
    next = {
      id: params.id,
      vendor: "bedrock",
      alias,
      apiKeyEnc,
      bedrockRegion: region,
      bedrockAuthMode: mode,
    };
  } else {
    const key = params.apiKey.trim();
    if (!key) throw new Error("API Key 不能为空");
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
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  bedrockSessionToken?: string;
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
      throw new Error("vendor 必须为 gemini、openrouter、qwen、bedrock、claude 或 jina");
    }
    vendor = params.vendor;
  }
  let apiKeyEnc = prev.apiKeyEnc;
  const secretProvided =
    params.apiKey !== undefined && params.apiKey.trim() !== "";
  const bedrockSecretProvided =
    (params.bedrockSecretAccessKey !== undefined && params.bedrockSecretAccessKey.trim() !== "") ||
    (params.bedrockAccessKeyId !== undefined && params.bedrockAccessKeyId.trim() !== "") ||
    (params.bedrockSessionToken !== undefined && params.bedrockSessionToken.trim() !== "");

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

  const bedrockRegion =
    params.bedrockRegion !== undefined
      ? params.bedrockRegion.trim()
      : (prev.bedrockRegion ?? "").trim();
  let bedrockAuthMode: BedrockAuthMode | undefined =
    params.bedrockAuthMode !== undefined ? params.bedrockAuthMode : prev.bedrockAuthMode;

  if (vendor === "bedrock") {
    if (params.bedrockRegion !== undefined && !bedrockRegion) {
      throw new Error("Bedrock 区域不能为空");
    }
    if (params.bedrockAuthMode !== undefined) {
      bedrockAuthMode = params.bedrockAuthMode;
    }
    const effectiveMode = bedrockAuthMode ?? prev.bedrockAuthMode;
    if (effectiveMode !== "iam" && effectiveMode !== "api_key") {
      throw new Error("Bedrock 认证方式须为 iam 或 api_key");
    }
    const switchingToBedrock = prev.vendor !== "bedrock" && vendor === "bedrock";
    if (switchingToBedrock && !secretProvided && !bedrockSecretProvided) {
      throw new Error("切换到 Bedrock 时请填写完整密钥");
    }
    if (secretProvided || bedrockSecretProvided) {
      if (effectiveMode === "api_key") {
        if (!secretProvided) throw new Error("Bedrock API Key 不能为空");
        apiKeyEnc = encryptBedrockApiKeyEnc("api_key", { apiKey: params.apiKey!.trim() });
      } else {
        const ak = (params.bedrockAccessKeyId ?? "").trim();
        const sk = (params.bedrockSecretAccessKey ?? "").trim();
        const prevPlain =
          prev.vendor === "bedrock" && isBedrockIamPayload(decryptSecret(prev.apiKeyEnc))
            ? parseBedrockIamPayload(decryptSecret(prev.apiKeyEnc))
            : null;
        const accessKeyId = ak || prevPlain?.accessKeyId || "";
        const secretAccessKey = sk || prevPlain?.secretAccessKey || "";
        const sessionTok =
          params.bedrockSessionToken !== undefined
            ? params.bedrockSessionToken.trim()
            : prevPlain?.sessionToken ?? "";
        if (!accessKeyId || !secretAccessKey) {
          throw new Error("Bedrock IAM 需要 Access Key ID 与 Secret Access Key");
        }
        apiKeyEnc = encryptBedrockApiKeyEnc("iam", {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
          sessionToken: sessionTok || undefined,
        });
      }
    }
  } else if (secretProvided) {
    apiKeyEnc = encryptSecret(params.apiKey!.trim());
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
    delete nextCred.bedrockRegion;
    delete nextCred.bedrockAuthMode;
  } else if (vendor === "bedrock") {
    delete nextCred.dashscopeCompatibleBase;
    nextCred.bedrockRegion = bedrockRegion || prev.bedrockRegion;
    nextCred.bedrockAuthMode = bedrockAuthMode ?? prev.bedrockAuthMode;
  } else {
    delete nextCred.dashscopeCompatibleBase;
    delete nextCred.bedrockRegion;
    delete nextCred.bedrockAuthMode;
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

  return persistStored({ ...cur, credentials });
}

/** @deprecated Use updateCredential */
export async function updateGeminiCredential(params: {
  id: string;
  alias?: string;
  apiKey?: string;
}): Promise<AiGatewayPublic> {
  return updateCredential(params);
}

/** Remove credential. */
export async function removeCredentialById(id: string): Promise<AiGatewayPublic> {
  const cur = await getAiGatewayStored();
  if (!cur.credentials.some((c) => c.id === id)) {
    throw new Error("凭证不存在");
  }
  const credentials = cur.credentials.filter((c) => c.id !== id);
  return persistStored({ ...cur, credentials });
}
