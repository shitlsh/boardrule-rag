/** Server-only: fetch & normalize OpenRouter models for the model picker (same shape as Gemini options). */

import type { SlotKey } from "@/lib/ai-gateway-types";
import type { AiModelOption } from "@/lib/ai-model-option";

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
  const mod = (m.architecture?.modality ?? "").toLowerCase();
  if (mod.includes("embed")) {
    return true;
  }
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
  // Common OpenRouter embedding families (architecture often omits output_modalities)
  if (
    /\b(voyage|jina-embed|jina-embeddings|multilingual-e5|mxe5|e5-mistral|e5-large|e5-base|e5-small|bge-m3|bge-large|bge-base|bge-small|gte-large|gte-base|snowflake-arctic-embed|mxbai-embed|llm-embedder|sentence-transformers)/i.test(
      i,
    )
  ) {
    return true;
  }
  if (/\/(embed|embedding)(\/|$|-)/i.test(i)) return true;
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

function parseOne(m: OpenRouterModelRaw): AiModelOption | null {
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

export async function fetchOpenRouterModelsFromApi(apiKey: string): Promise<AiModelOption[]> {
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
  const out: AiModelOption[] = [];
  for (const m of raw) {
    const p = parseOne(m);
    if (p) out.push(p);
  }
  return out;
}

function isEmbedOnly(m: AiModelOption): boolean {
  return m.capabilities.embedContent && !m.capabilities.generateContent;
}

/** Same slot rules as Gemini list. */
export function filterOpenRouterModelsForSlot(
  models: AiModelOption[],
  slot: SlotKey,
): AiModelOption[] {
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

/** When strict parsing marks nothing as embed-capable, match likely embedding ids (OpenRouter id = vendor/model). */
function relaxedOpenRouterEmbedId(id: string): boolean {
  const i = id.toLowerCase();
  if (/\b(chat|instruct|vision|vl-|4o|claude|gpt-4|gemini-2\.0-flash|reasoning)\b/i.test(i)) {
    return false;
  }
  return /\b(embed|embedding|text-embedding|voyage|jina-embed|e5-|bge-|gte-|snowflake|arctic-embed|mxbai|sentence-transformers|minilm|nomic-embed|cohere\/embed)/i.test(
    i,
  );
}

export async function fetchOpenRouterModelsForSlot(
  apiKey: string,
  slot: SlotKey,
): Promise<AiModelOption[]> {
  const all = await fetchOpenRouterModelsFromApi(apiKey);
  const filtered = filterOpenRouterModelsForSlot(all, slot);
  if (slot === "embed" && filtered.length === 0 && all.length > 0) {
    const relaxed = all
      .filter((m) => relaxedOpenRouterEmbedId(m.name))
      .map((m) => ({
        ...m,
        capabilities: { generateContent: false, embedContent: true },
        visionHint: false,
      }));
    if (relaxed.length > 0) {
      return relaxed;
    }
  }
  return filtered;
}
