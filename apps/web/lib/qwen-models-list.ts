/** Server-only: DashScope OpenAI-compatible model list (Alibaba Bailian / Qwen). */

import type { SlotKey } from "@/lib/ai-gateway-types";
import {
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

type OpenAIListModelsResponse = {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
};

function isEmbeddingModelId(id: string): boolean {
  const s = id.toLowerCase();
  if (s.includes("text-embedding")) return true;
  // e.g. multimodal-embedding-v1, qwen3-embedding-*
  if (/\bembedding\b/.test(s)) return true;
  // DashScope sometimes uses hyphenated embed-* ids
  if (/[-_]embed[-_]/.test(s)) return true;
  return false;
}

function inferVisionHint(id: string): boolean {
  const s = id.toLowerCase();
  return s.includes("vl") || s.includes("vision") || s.includes("omni");
}

function toOption(id: string): GeminiModelOption {
  const embed = isEmbeddingModelId(id);
  const canGen = !embed;
  const canEmbed = embed;
  return {
    name: id,
    displayName: id,
    description: `DashScope / 百炼模型 ${id}`,
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: {
      generateContent: canGen,
      embedContent: canEmbed,
    },
    visionHint: canGen && inferVisionHint(id),
  };
}

/** Curated fallbacks when GET /models is unavailable (still valid model ids for many accounts). */
const FALLBACK_IDS: string[] = [
  "qwen-plus",
  "qwen-turbo",
  "qwen-max",
  "qwen-flash",
  "qwen3-max",
  "qwen-vl-plus",
  "qwen-vl-max",
  "qwen2.5-72b-instruct",
  "qwen2.5-32b-instruct",
  "text-embedding-v4",
  "text-embedding-v3",
  "text-embedding-v2",
  "text-embedding-v1",
  "multimodal-embedding-v1",
];

/** Shown when /models returns chat-only models but user opens the Embed slot (same ids as fallbacks). */
const DASHSCOPE_EMBED_SLOT_EXTRA: string[] = [
  "text-embedding-v4",
  "text-embedding-v3",
  "text-embedding-v2",
  "text-embedding-v1",
  "multimodal-embedding-v1",
];

function parseOpenAIList(data: OpenAIListModelsResponse): GeminiModelOption[] {
  const raw = data.data ?? [];
  const out: GeminiModelOption[] = [];
  for (const m of raw) {
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (id) out.push(toOption(id));
  }
  return out;
}

export async function fetchQwenModelsFromApi(
  apiKey: string,
  compatibleBase?: string,
): Promise<GeminiModelOption[]> {
  const base = normalizeDashscopeCompatibleBase(compatibleBase ?? DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
  const url = `${base}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    next: { revalidate: 0 },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 || res.status === 405) {
      return FALLBACK_IDS.map(toOption);
    }
    throw new Error(text || `DashScope API error: ${res.status}`);
  }
  let data: OpenAIListModelsResponse;
  try {
    data = JSON.parse(text) as OpenAIListModelsResponse;
  } catch {
    return FALLBACK_IDS.map(toOption);
  }
  const parsed = parseOpenAIList(data);
  return parsed.length > 0 ? parsed : FALLBACK_IDS.map(toOption);
}

function isEmbedOnly(m: GeminiModelOption): boolean {
  return m.capabilities.embedContent && !m.capabilities.generateContent;
}

export function filterQwenModelsForSlot(models: GeminiModelOption[], slot: SlotKey): GeminiModelOption[] {
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

export async function fetchQwenModelsForSlot(
  apiKey: string,
  slot: SlotKey,
  compatibleBase?: string,
): Promise<GeminiModelOption[]> {
  const all = await fetchQwenModelsFromApi(apiKey, compatibleBase);
  let out = filterQwenModelsForSlot(all, slot);
  if (slot === "embed" && out.length === 0) {
    const seen = new Set(all.map((m) => m.name));
    for (const id of DASHSCOPE_EMBED_SLOT_EXTRA) {
      if (!seen.has(id)) {
        out = [...out, toOption(id)];
        seen.add(id);
      }
    }
  }
  return out;
}
