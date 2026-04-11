/**
 * Server-only: list models for a saved credential (Gemini, OpenRouter, or Qwen/DashScope).
 * Used by /api/ai/models and slot binding validation.
 */

import type { AiGatewayStored, SlotKey } from "@/lib/ai-gateway-types";
import {
  getCredentialApiKey,
  getCredentialDashscopeCompatibleBase,
  getCredentialVendor,
  getStoredCredential,
} from "@/lib/ai-gateway";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import { enrichModelMetadata } from "@/lib/model-metadata-enrich";
import {
  fetchOpenRouterModelsForSlot,
  fetchOpenRouterModelsFromApi,
} from "@/lib/openrouter-models-list";
import { fetchQwenModelsForSlot, fetchQwenModelsFromApi } from "@/lib/qwen-models-list";

function applyCredentialModelFilters(
  cred: NonNullable<ReturnType<typeof getStoredCredential>>,
  models: GeminiModelOption[],
): GeminiModelOption[] {
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
): Promise<GeminiModelOption[]> {
  const cred = getStoredCredential(stored, credentialId);
  if (!cred || cred.enabled === false) {
    return [];
  }
  const vendor = getCredentialVendor(stored, credentialId);
  const apiKey = getCredentialApiKey(stored, credentialId);
  let models: GeminiModelOption[];
  if (vendor === "openrouter") {
    models = slot
      ? await fetchOpenRouterModelsForSlot(apiKey, slot)
      : await fetchOpenRouterModelsFromApi(apiKey);
  } else if (vendor === "qwen") {
    const base = getCredentialDashscopeCompatibleBase(stored, credentialId);
    models = slot
      ? await fetchQwenModelsForSlot(apiKey, slot, base)
      : await fetchQwenModelsFromApi(apiKey, base);
  } else {
    models = slot ? await fetchGeminiModelsForSlot(apiKey, slot) : await fetchGeminiModelsFromGoogle(apiKey);
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
): Promise<GeminiModelOption[]> {
  return fetchModelsForCredential(stored, credentialId, slot);
}
