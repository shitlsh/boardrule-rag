/**
 * Server-only: list models for a saved credential (Gemini, OpenRouter, Qwen/DashScope, Bedrock, or Claude).
 * Used by /api/ai/models and slot binding validation.
 */

import type { AiGatewayStored, SlotKey } from "@/lib/ai-gateway-types";
import {
  getCredentialApiKey,
  getCredentialDashscopeCompatibleBase,
  getCredentialVendor,
  getStoredCredential,
} from "@/lib/ai-gateway";
import { fetchBedrockModelsForStoredCredential } from "@/lib/bedrock-models-list";
import { fetchClaudeModelsForSlot, fetchClaudeModelsFromApi } from "@/lib/claude-models-list";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import type { AiModelOption } from "@/lib/ai-model-option";
import { enrichModelMetadata } from "@/lib/model-metadata-enrich";
import {
  fetchOpenRouterModelsForSlot,
  fetchOpenRouterModelsFromApi,
} from "@/lib/openrouter-models-list";
import { fetchQwenModelsForSlot, fetchQwenModelsFromApi } from "@/lib/qwen-models-list";
import { listJinaModelsForSlot } from "@/lib/jina-models-list";

function applyCredentialModelFilters(
  cred: NonNullable<ReturnType<typeof getStoredCredential>>,
  models: AiModelOption[],
): AiModelOption[] {
  const hidden = new Set(cred.hiddenModelIds ?? []);
  if (hidden.size === 0) return models;
  return models.filter((m) => !hidden.has(m.name));
}

export type FetchModelsForCredentialOptions = {
  /** When true, return all vendor models (still excludes disabled credential). Used by credential UI to toggle hidden models. */
  includeHidden?: boolean;
};

/** All models for vendor, optionally filtered by slot capability. */
export async function fetchModelsForCredential(
  stored: AiGatewayStored,
  credentialId: string,
  slot: SlotKey | null,
  options?: FetchModelsForCredentialOptions,
): Promise<AiModelOption[]> {
  const cred = getStoredCredential(stored, credentialId);
  if (!cred || cred.enabled === false) {
    return [];
  }
  const vendor = getCredentialVendor(stored, credentialId);
  let models: AiModelOption[];
  if (vendor === "bedrock") {
    models = await fetchBedrockModelsForStoredCredential(stored, credentialId, slot);
  } else {
    const apiKey = getCredentialApiKey(stored, credentialId);
    if (vendor === "openrouter") {
      models = slot
        ? await fetchOpenRouterModelsForSlot(apiKey, slot)
        : await fetchOpenRouterModelsFromApi(apiKey);
    } else if (vendor === "qwen") {
      const base = getCredentialDashscopeCompatibleBase(stored, credentialId);
      models = slot
        ? await fetchQwenModelsForSlot(apiKey, slot, base)
        : await fetchQwenModelsFromApi(apiKey, base);
    } else if (vendor === "claude") {
      models = slot
        ? await fetchClaudeModelsForSlot(apiKey, slot)
        : await fetchClaudeModelsFromApi(apiKey);
    } else if (vendor === "jina") {
      if (slot === "embed" || slot === "rerank") {
        models = listJinaModelsForSlot(slot);
      } else if (slot === null) {
        // Credential UI loads all models without slot; Jina has no remote list API — use embed + rerank ids.
        const seen = new Set<string>();
        models = [];
        for (const m of [...listJinaModelsForSlot("embed"), ...listJinaModelsForSlot("rerank")]) {
          if (seen.has(m.name)) continue;
          seen.add(m.name);
          models.push(m);
        }
      } else {
        models = [];
      }
    } else {
      models = slot ? await fetchGeminiModelsForSlot(apiKey, slot) : await fetchGeminiModelsFromGoogle(apiKey);
    }
  }
  models = enrichModelMetadata(vendor, models);
  if (options?.includeHidden) {
    return models;
  }
  return applyCredentialModelFilters(cred, models);
}

/** Slot is required (e.g. validating a binding). */
export async function fetchModelsForCredentialSlot(
  stored: AiGatewayStored,
  credentialId: string,
  slot: SlotKey,
): Promise<AiModelOption[]> {
  return fetchModelsForCredential(stored, credentialId, slot);
}
