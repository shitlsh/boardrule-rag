/**
 * Enrich model rows using vendored metadata from Dify official plugins (tongyi / gemini / openrouter).
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

function lookup(vendor: AiVendor, modelName: string): DifyModelMetadataEntry | null {
  const registry = byVendor[vendor];
  if (!registry || Object.keys(registry).length === 0) return null;
  if (vendor === "gemini") {
    return lookupGemini(registry, modelName);
  }
  return lookupOpenRouterOrQwen(registry, modelName);
}

export function enrichModelsWithDifyMetadata(
  vendor: AiVendor,
  models: GeminiModelOption[],
): GeminiModelOption[] {
  if (vendor !== "qwen" && vendor !== "gemini" && vendor !== "openrouter") {
    return models;
  }

  return models.map((m) => {
    const row = lookup(vendor, m.name);
    if (!row) return m;

    const litellmMode = row.mode;
    const litellmMaxInputTokens =
      typeof row.contextSize === "number" && row.contextSize > 0 ? row.contextSize : undefined;
    const litellmMaxOutputTokens =
      typeof row.maxOutputTokens === "number" && row.maxOutputTokens > 0 ? row.maxOutputTokens : undefined;
    const supportsVision = row.supportsVision;

    return {
      ...m,
      ...(litellmMode ? { litellmMode } : {}),
      ...(litellmMaxInputTokens !== undefined ? { litellmMaxInputTokens } : {}),
      ...(litellmMaxOutputTokens !== undefined ? { litellmMaxOutputTokens } : {}),
      ...(supportsVision !== undefined ? { supportsVision } : {}),
    };
  });
}
