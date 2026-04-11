/**
 * Server-only: enrich vendor model lists using LiteLLM's model_prices_and_context_window.json
 * (vendored at lib/data/litellm-model-prices.json).
 */

import type { AiVendor } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

import litellmModelPrices from "./data/litellm-model-prices.json";

type LitellmRow = {
  max_input_tokens?: number;
  max_tokens?: number;
  max_output_tokens?: number;
  mode?: string;
  supports_vision?: boolean;
  litellm_provider?: string;
};

const SKIP_KEYS = new Set(["sample_spec"]);

const registryStatic = litellmModelPrices as unknown as Record<string, LitellmRow>;

let registryCache: Record<string, LitellmRow> | null = null;

export function getLitellmRegistry(): Record<string, LitellmRow> {
  if (!registryCache) registryCache = registryStatic;
  return registryCache;
}

/** Exposed for tests / debugging candidate coverage. */
export function candidateLitellmKeys(vendor: AiVendor, modelName: string): string[] {
  const id = modelName.trim();
  const short = id.replace(/^models\//, "");
  if (vendor === "openrouter") {
    return [`openrouter/${id}`, `openrouter/${short}`, id, short];
  }
  if (vendor === "qwen") {
    return [`dashscope/${short}`, `dashscope/${id}`, `openai/${short}`, short];
  }
  return [`gemini/${short}`, `gemini/${id}`, short, `google/${short}`, id];
}

function lookupRow(
  registry: Record<string, LitellmRow>,
  vendor: AiVendor,
  modelName: string,
): LitellmRow | null {
  for (const k of candidateLitellmKeys(vendor, modelName)) {
    if (SKIP_KEYS.has(k)) continue;
    const row = registry[k];
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return row;
    }
  }
  return null;
}

export function enrichModelsWithLitellm(
  vendor: AiVendor,
  models: GeminiModelOption[],
): GeminiModelOption[] {
  const registry = getLitellmRegistry();
  if (Object.keys(registry).length === 0) return models;

  return models.map((m) => {
    const row = lookupRow(registry, vendor, m.name);
    if (!row) return m;

    let litellmMaxInputTokens: number | undefined;
    if (typeof row.max_input_tokens === "number" && row.max_input_tokens > 0) {
      litellmMaxInputTokens = row.max_input_tokens;
    }

    let litellmMaxOutputTokens: number | undefined;
    if (typeof row.max_output_tokens === "number" && row.max_output_tokens > 0) {
      litellmMaxOutputTokens = row.max_output_tokens;
    }

    const litellmMode = typeof row.mode === "string" && row.mode.trim() !== "" ? row.mode.trim() : undefined;

    const supportsVision = typeof row.supports_vision === "boolean" ? row.supports_vision : undefined;

    return {
      ...m,
      ...(litellmMode ? { litellmMode } : {}),
      ...(litellmMaxInputTokens !== undefined ? { litellmMaxInputTokens } : {}),
      ...(litellmMaxOutputTokens !== undefined ? { litellmMaxOutputTokens } : {}),
      ...(supportsVision !== undefined ? { supportsVision } : {}),
    };
  });
}
