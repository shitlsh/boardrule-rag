/**
 * Enrich model rows using vendored metadata from Dify official plugins (tongyi / gemini / openrouter / bedrock).
 * Generated JSON: lib/data/dify-model-metadata.json — see scripts/sync-dify-model-metadata.mjs.
 */

import type { AiVendor } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

import difyModelMetadata from "./data/dify-model-metadata.json";

export type DifyModelMetadataEntry = {
  model: string;
  category: "llm" | "text_embedding";
  modelType: string;
  mode?: string;
  contextSize?: number;
  supportsVision: boolean;
  maxOutputTokens?: number;
  features?: string[];
};

type VendorRegistry = Record<string, DifyModelMetadataEntry>;

const byVendor = difyModelMetadata as unknown as Record<AiVendor, VendorRegistry | undefined>;

function geminiShort(id: string): string {
  return id.trim().replace(/^models\//, "");
}

function lookupOpenRouterOrQwen(registry: VendorRegistry, modelName: string): DifyModelMetadataEntry | null {
  const n = modelName.trim();
  if (registry[n]) return registry[n];
  const nl = n.toLowerCase();
  for (const k of Object.keys(registry)) {
    if (k.toLowerCase() === nl) return registry[k];
  }
  return null;
}

/** DashScope uses qwen3.5-… IDs; Dify YAML may only list qwen3-… — normalize for lookup. */
function normalizeQwenModelId(modelName: string): string {
  return modelName.trim().replace(/^qwen3\.5-/i, "qwen3-");
}

/**
 * Tongyi registry keys are exact Dify model ids. Newer API ids (dated / realtime / qwen3.5-)
 * often extend a known family — match longest registry key that is a strict prefix of the id.
 */
function lookupQwenByPrefix(registry: VendorRegistry, normalizedName: string): DifyModelMetadataEntry | null {
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const k of Object.keys(registry)) {
    if (normalizedName === k || normalizedName.toLowerCase() === k.toLowerCase()) {
      return registry[k];
    }
    if (normalizedName.startsWith(`${k}-`) && k.length > bestLen) {
      bestLen = k.length;
      bestKey = k;
    }
  }
  return bestKey ? registry[bestKey] : null;
}

/**
 * e.g. qwen3-omni-flash-realtime-2026-03-15 does not extend qwen3-omni-flash-2025-12-01 by prefix,
 * but both belong to omni-flash — map to any registry key under that family (longest wins).
 */
function lookupQwenOmniFamily(registry: VendorRegistry, normalizedName: string): DifyModelMetadataEntry | null {
  const m = normalizedName.match(/^(qwen3-omni-(?:flash|plus))(?:-|$)/i);
  if (!m) return null;
  const family = m[1];
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const k of Object.keys(registry)) {
    if (k === family || k.startsWith(`${family}-`)) {
      if (k.length > bestLen) {
        bestLen = k.length;
        bestKey = k;
      }
    }
  }
  return bestKey ? registry[bestKey] : null;
}

/**
 * Dify may only ship e.g. qwen3-omni-flash-* while DashScope exposes qwen3.5-omni-plus-* — no plus YAML yet.
 * Use longest qwen3-omni-* registry entry as best-effort multimodal metadata (until tongyi adds those ids).
 */
function lookupQwenOmniLoose(registry: VendorRegistry, normalizedName: string): DifyModelMetadataEntry | null {
  if (!/^qwen3-omni-/i.test(normalizedName)) return null;
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const k of Object.keys(registry)) {
    if (/^qwen3-omni-/i.test(k) && k.length > bestLen) {
      bestLen = k.length;
      bestKey = k;
    }
  }
  return bestKey ? registry[bestKey] : null;
}

function lookupQwen(registry: VendorRegistry, modelName: string): DifyModelMetadataEntry | null {
  const direct = lookupOpenRouterOrQwen(registry, modelName);
  if (direct) return direct;

  const n = normalizeQwenModelId(modelName);
  const byPrefix = lookupQwenByPrefix(registry, n);
  if (byPrefix) return byPrefix;

  const family = lookupQwenOmniFamily(registry, n);
  if (family) return family;

  return lookupQwenOmniLoose(registry, n);
}

function lookupGemini(registry: VendorRegistry, modelName: string): DifyModelMetadataEntry | null {
  const short = geminiShort(modelName);
  for (const k of Object.keys(registry)) {
    if (geminiShort(k) === short) return registry[k];
  }
  const nls = short.toLowerCase();
  for (const k of Object.keys(registry)) {
    if (geminiShort(k).toLowerCase() === nls) return registry[k];
  }
  return null;
}

/**
 * Dify Bedrock YAML keys are often provider families ("anthropic claude", "amazon nova") or
 * dotted model ids ("amazon.titan-embed-text-v2:0"). ListFoundationModels returns full
 * foundation model ids (e.g. anthropic.claude-opus-4-5-…); map those to the closest registry row.
 */
function inferBedrockFamilyDifyKey(modelId: string): string | null {
  const s = modelId.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("anthropic.")) return "anthropic claude";
  if (s.startsWith("amazon.nova")) return "amazon nova";
  if (s.startsWith("amazon.titan")) return null;
  if (s.startsWith("amazon.")) return "amazon nova";
  if (s.startsWith("cohere.")) return "cohere";
  if (s.startsWith("meta.")) return "meta";
  if (s.startsWith("mistral.")) return "mistral";
  if (s.startsWith("ai21.")) return "ai21";
  if (s.startsWith("deepseek.")) return "deepseek";
  if (s.startsWith("openai.")) return "openai";
  if (s.startsWith("qwen.")) return "qwen";
  if (s.startsWith("twelvelabs.")) return null;
  return null;
}

function isBoundaryAfterPrefix(idLower: string, keyLen: number): boolean {
  if (keyLen >= idLower.length) return true;
  const c = idLower[keyLen];
  return c === "." || c === ":" || c === "-" || c === "_" || c === "/";
}

function lookupBedrock(registry: VendorRegistry, modelName: string): DifyModelMetadataEntry | null {
  const id = modelName.trim();
  if (!id) return null;

  const direct = lookupOpenRouterOrQwen(registry, id);
  if (direct) return direct;

  const idLower = id.toLowerCase();

  let bestKey: string | null = null;
  let bestLen = -1;
  for (const k of Object.keys(registry)) {
    const kl = k.toLowerCase();
    if (idLower === kl) return registry[k];
    if (idLower.startsWith(kl) && isBoundaryAfterPrefix(idLower, kl.length) && kl.length > bestLen) {
      bestLen = kl.length;
      bestKey = k;
    }
  }
  if (bestKey) return registry[bestKey];

  bestKey = null;
  bestLen = -1;
  for (const k of Object.keys(registry)) {
    const kl = k.toLowerCase();
    if (kl.startsWith(idLower) && isBoundaryAfterPrefix(kl, idLower.length) && kl.length > bestLen) {
      bestLen = kl.length;
      bestKey = k;
    }
  }
  if (bestKey) return registry[bestKey];

  const family = inferBedrockFamilyDifyKey(id);
  if (!family) return null;
  if (registry[family]) return registry[family];
  for (const k of Object.keys(registry)) {
    if (k.toLowerCase() === family.toLowerCase()) return registry[k];
  }
  return null;
}

function lookup(vendor: AiVendor, modelName: string): DifyModelMetadataEntry | null {
  const registry = byVendor[vendor];
  if (!registry || Object.keys(registry).length === 0) return null;
  if (vendor === "gemini") {
    return lookupGemini(registry, modelName);
  }
  if (vendor === "qwen") {
    return lookupQwen(registry, modelName);
  }
  if (vendor === "bedrock") {
    return lookupBedrock(registry, modelName);
  }
  return lookupOpenRouterOrQwen(registry, modelName);
}

export function enrichModelsWithDifyMetadata(
  vendor: AiVendor,
  models: GeminiModelOption[],
): GeminiModelOption[] {
  if (vendor !== "qwen" && vendor !== "gemini" && vendor !== "openrouter" && vendor !== "bedrock") {
    return models;
  }

  return models.map((m) => {
    const row = lookup(vendor, m.name);
    if (!row) return m;

    const fromContext =
      typeof row.contextSize === "number" && row.contextSize > 0 ? row.contextSize : undefined;
    const fromMaxOut =
      typeof row.maxOutputTokens === "number" && row.maxOutputTokens > 0 ? row.maxOutputTokens : undefined;

    const inputTokenLimit = m.inputTokenLimit ?? (fromContext ?? null);
    const outputTokenLimit = m.outputTokenLimit ?? (fromMaxOut ?? null);

    const modelMode = row.mode?.trim() ? row.mode.trim() : undefined;
    const supportsVision = row.supportsVision;
    const visionHint = supportsVision ? true : false;

    return {
      ...m,
      inputTokenLimit,
      outputTokenLimit,
      visionHint,
      supportsVision,
      ...(modelMode ? { modelMode } : {}),
    };
  });
}
