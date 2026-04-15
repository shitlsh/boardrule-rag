/** Server-only: fetch & normalize Claude models from Anthropic GET /v1/models. */

import type { SlotKey } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicModel = {
  id?: string;
  display_name?: string;
  created_at?: string;
  type?: string;
};

type AnthropicListModelsResponse = {
  data?: AnthropicModel[];
  has_more?: boolean;
  first_id?: string;
  last_id?: string;
};

function isVisionModel(id: string): boolean {
  // All Claude 3+ models support vision; Claude 2 / instant do not.
  return /claude-3/i.test(id) || /claude-3\./i.test(id);
}

// Parameter reserved when Anthropic exposes embed models in /v1/models.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- arity matches call sites
function isEmbedModel(_id: string): boolean {
  // Anthropic does not expose embedding models via /v1/models in the same list;
  // treat none as embed-only for now.
  return false;
}

function isGenerationModel(id: string): boolean {
  // All models in /v1/models are generation models for Anthropic.
  return !isEmbedModel(id);
}

function normalizeClaudeModel(m: AnthropicModel): GeminiModelOption | null {
  const id = (m.id ?? "").trim();
  if (!id) return null;
  const displayName = (m.display_name ?? id).trim();
  const canGen = isGenerationModel(id);
  const visionHint = canGen && isVisionModel(id);
  return {
    name: id,
    displayName,
    description: "",
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: {
      generateContent: canGen,
      embedContent: isEmbedModel(id),
    },
    visionHint,
  };
}

export async function fetchClaudeModelsFromApi(apiKey: string): Promise<GeminiModelOption[]> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic /v1/models 失败（${res.status}）: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as AnthropicListModelsResponse;
  const raw = Array.isArray(json.data) ? json.data : [];
  return raw.flatMap((m) => {
    const opt = normalizeClaudeModel(m);
    return opt ? [opt] : [];
  });
}

/** Filter Claude models by slot capability. */
export function filterClaudeModelsForSlot(
  models: GeminiModelOption[],
  slot: SlotKey,
): GeminiModelOption[] {
  if (slot === "embed") {
    return models.filter((m) => m.capabilities.embedContent);
  }
  // flash, pro, chat — all generation models
  return models.filter((m) => m.capabilities.generateContent);
}

export async function fetchClaudeModelsForSlot(
  apiKey: string,
  slot: SlotKey,
): Promise<GeminiModelOption[]> {
  const all = await fetchClaudeModelsFromApi(apiKey);
  return filterClaudeModelsForSlot(all, slot);
}
