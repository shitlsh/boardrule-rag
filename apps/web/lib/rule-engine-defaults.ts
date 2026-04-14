/**
 * Human-readable defaults for UI copy. Keep in sync with `services/rule_engine`
 * (see `graphs/extraction_settings.py`, `graphs/nodes/chapter_extract.py`, `utils/llm_generate.py`,
 * `utils/bedrock_converse.py`, `.env.example`).
 */

export const EXTRACTION_RUNTIME_DEFAULTS = {
  visionBatchPages: 6,
  extractionSimpleMaxBodyPages: 10,
  extractionSimplePathWarnBodyPages: 32,
  needMoreContextMaxExpand: 8,
  llmMaxContinuationRounds: 6,
  geminiHttpTimeoutMs: 120_000,
  dashscopeHttpTimeoutMs: 120_000,
  openrouterHttpTimeoutMs: 120_000,
  /** Bedrock Runtime `converse` read timeout (ms); engine default 120s when unset (`utils/bedrock_converse.py`). */
  bedrockHttpTimeoutMs: 120_000,
} as const;

/** When env and profile omit `VISION_MAX_MERGE_PAGES`, engine uses `min(48, max(12, visionBatchPages * 4))`. */
export function defaultVisionMaxMergePages(visionBatchPages: number): number {
  return Math.min(48, Math.max(12, visionBatchPages * 4));
}

/** Flash/Pro slot when `maxOutputTokens` omitted (`utils/llm_generate.py`). */
export const EXTRACTION_SLOT_MAX_OUTPUT_DEFAULT = 32_768;

/** RAG / chunk defaults (`services/rule_engine/.env.example`, `ingestion/index_builder.py`). */
export const INDEX_RAG_DEFAULTS = {
  chunkSize: 1024,
  chunkOverlap: 128,
  similarityTopK: 8,
  rerankTopN: 5,
  /** SentenceTransformers cross-encoder id (local download); matches `_DEFAULT_RERANK_MODEL` / `RERANK_MODEL`. */
  rerankModel: "BAAI/bge-reranker-base",
  retrievalMode: "hybrid" as const,
  useRerank: true,
};
