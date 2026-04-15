/**
 * Jina Cloud models for index embed / rerank slots.
 * Primary source: vendored `dify-model-metadata.json` (from `npm run sync:dify-model-metadata`);
 * falls back to static ids when the registry is empty.
 */

import type { AiModelOption } from "@/lib/ai-model-option";

import difyModelMetadata from "./data/dify-model-metadata.json";

type DifyEntry = {
  model?: string;
  category?: string;
};

const FALLBACK_EMBED: AiModelOption[] = [
  {
    name: "jina-embeddings-v3",
    displayName: "jina-embeddings-v3",
    description: "Jina embeddings v3",
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: { generateContent: false, embedContent: true },
    visionHint: false,
  },
  {
    name: "jina-embedding-v2-base-en",
    displayName: "jina-embedding-v2-base-en",
    description: "Jina embedding v2 base (EN)",
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: { generateContent: false, embedContent: true },
    visionHint: false,
  },
];

const FALLBACK_RERANK: AiModelOption[] = [
  {
    name: "jina-reranker-v2-base-multilingual",
    displayName: "jina-reranker-v2-base-multilingual",
    description: "Jina reranker v2 multilingual",
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: { generateContent: false, embedContent: false },
    visionHint: false,
  },
  {
    name: "jina-reranker-v3",
    displayName: "jina-reranker-v3",
    description: "Jina reranker v3",
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: { generateContent: false, embedContent: false },
    visionHint: false,
  },
];

function entryToOption(entry: DifyEntry, kind: "embed" | "rerank"): AiModelOption {
  const id = typeof entry.model === "string" ? entry.model.trim() : "";
  const embed = kind === "embed";
  return {
    name: id,
    displayName: id,
    description: `Jina (${entry.category ?? (embed ? "text_embedding" : "rerank")})`,
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: { generateContent: false, embedContent: embed },
    visionHint: false,
  };
}

/** Models for Jina credential: `embed` → text_embedding YAML; `rerank` → rerank YAML. */
export function listJinaModelsForSlot(slot: "embed" | "rerank"): AiModelOption[] {
  const want = slot === "embed" ? "text_embedding" : "rerank";
  const bucket = (difyModelMetadata as { jina?: Record<string, DifyEntry> }).jina ?? {};
  const out: AiModelOption[] = [];
  for (const [, raw] of Object.entries(bucket)) {
    if (!raw || typeof raw !== "object") continue;
    const cat = raw.category;
    if (cat !== want) continue;
    const id = typeof raw.model === "string" ? raw.model.trim() : "";
    if (!id) continue;
    out.push(entryToOption(raw, slot));
  }
  if (out.length > 0) return out;
  return slot === "embed" ? FALLBACK_EMBED : FALLBACK_RERANK;
}
