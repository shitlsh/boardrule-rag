/**
 * Server-only: list models for a saved credential (Gemini vs OpenRouter).
 * Used by /api/ai/models and slot binding validation.
 */

import type { AiGatewayStored, SlotKey } from "@/lib/ai-gateway-types";
import { getCredentialApiKey, getCredentialVendor } from "@/lib/ai-gateway";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import {
  fetchOpenRouterModelsForSlot,
  fetchOpenRouterModelsFromApi,
} from "@/lib/openrouter-models-list";

/** All models for vendor, optionally filtered by slot capability. */
export async function fetchModelsForCredential(
  stored: AiGatewayStored,
  credentialId: string,
  slot: SlotKey | null,
): Promise<GeminiModelOption[]> {
  const vendor = getCredentialVendor(stored, credentialId);
  const apiKey = getCredentialApiKey(stored, credentialId);
  if (vendor === "openrouter") {
    return slot
      ? await fetchOpenRouterModelsForSlot(apiKey, slot)
      : await fetchOpenRouterModelsFromApi(apiKey);
  }
  return slot ? await fetchGeminiModelsForSlot(apiKey, slot) : await fetchGeminiModelsFromGoogle(apiKey);
}

/** Slot is required (e.g. validating a binding). */
export async function fetchModelsForCredentialSlot(
  stored: AiGatewayStored,
  credentialId: string,
  slot: SlotKey,
): Promise<GeminiModelOption[]> {
  return fetchModelsForCredential(stored, credentialId, slot);
}
