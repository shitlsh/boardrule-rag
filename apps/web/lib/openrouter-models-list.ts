/** Server-only: fetch & normalize OpenRouter models for the model picker (same shape as Gemini options). */

import type { SlotKey } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

type OpenRouterModelRaw = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
};

type OpenRouterListResponse = {
  data?: OpenRouterModelRaw[];
};

function isEmbeddingModel(m: OpenRouterModelRaw): boolean {
  const id = typeof m.id === "string" ? m.id : "";
  const i = id.toLowerCase();
  const name = typeof m.name === "string" ? m.name : "";
  const desc = typeof m.description === "string" ? m.description : "";
  const blob = `${name} ${desc}`.toLowerCase();
  const outs = m.architecture?.output_modalities ?? [];
  if (outs.some((x) => String(x).toLowerCase().includes("embed"))) {
    return true;
  }
  if (/\bembedding\b/.test(blob) && !/\bchat completion\b/.test(blob)) {
    return true;
  }
  if (i.includes("text-embedding") || i.includes("/embed") || i.endsWith("/embed")) {
    return true;
  }
  if (/^cohere\/embed/.test(i)) return true;
  return false;
}

function inferVisionHint(m: OpenRouterModelRaw, canGen: boolean): boolean {
  if (!canGen) return false;
  const mod = (m.architecture?.modality ?? "").toLowerCase();
  const ins = m.architecture?.input_modalities ?? [];
  if (mod.includes("image") || mod.includes("multimodal")) return true;
  if (ins.some((x) => /image|vision/i.test(String(x)))) return true;
  const id = (m.id ?? "").toLowerCase();
  const name = (m.name ?? "").toLowerCase();
  if (/\b(vision|vl-|4v|gpt-4o|claude-3|gemini|multimodal)\b/.test(`${id} ${name}`)) {
    return true;
  }
  return false;
}

function parseOne(m: OpenRouterModelRaw): GeminiModelOption | null {
  const id = typeof m.id === "string" ? m.id.trim() : "";
  if (!id) return null;
  const name = typeof m.name === "string" ? m.name.trim() : "";
  const description = typeof m.description === "string" ? m.description : "";
  const displayName = name || id;
  const embed = isEmbeddingModel(m);
  const canGen = !embed;
  const canEmbed = embed;
  return {
    name: id,
    displayName,
    description: description || `OpenRouter model ${id}`,
    inputTokenLimit:
      typeof m.context_length === "number" && Number.isFinite(m.context_length)
        ? m.context_length
        : null,
    outputTokenLimit: null,
    capabilities: {
      generateContent: canGen,
      embedContent: canEmbed,
    },
    visionHint: inferVisionHint(m, canGen),
  };
}

export async function fetchOpenRouterModelsFromApi(apiKey: string): Promise<GeminiModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    next: { revalidate: 0 },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `OpenRouter API error: ${res.status}`);
  }
  const data = JSON.parse(text) as OpenRouterListResponse;
  const raw = data.data ?? [];
  const out: GeminiModelOption[] = [];
  for (const m of raw) {
    const p = parseOne(m);
    if (p) out.push(p);
  }
  return out;
}

function isEmbedOnly(m: GeminiModelOption): boolean {
  return m.capabilities.embedContent && !m.capabilities.generateContent;
}

/** Same slot rules as Gemini list. */
export function filterOpenRouterModelsForSlot(
  models: GeminiModelOption[],
  slot: SlotKey,
): GeminiModelOption[] {
  switch (slot) {
    case "embed":
      return models.filter((m) => m.capabilities.embedContent);
    case "flash":
    case "pro":
    case "chat":
      return models.filter((m) => m.capabilities.generateContent && !isEmbedOnly(m));
    default:
      return models;
  }
}

export async function fetchOpenRouterModelsForSlot(
  apiKey: string,
  slot: SlotKey,
): Promise<GeminiModelOption[]> {
  const all = await fetchOpenRouterModelsFromApi(apiKey);
  return filterOpenRouterModelsForSlot(all, slot);
}
