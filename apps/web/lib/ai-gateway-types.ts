export type AiVendor = "gemini" | "openrouter" | "qwen";

export const AI_VENDOR_IDS: readonly AiVendor[] = ["gemini", "openrouter", "qwen"];

export function isAiVendor(v: string): v is AiVendor {
  return (AI_VENDOR_IDS as readonly string[]).includes(v);
}

export type SlotKey = "flash" | "pro" | "embed" | "chat";

export type AiCredentialStored = {
  id: string;
  vendor: AiVendor;
  /** Globally unique (case-insensitive after trim). */
  alias: string;
  apiKeyEnc: string;
  /**
   * vendor === "qwen" only: DashScope OpenAI-compatible base URL (no trailing slash).
   * Persisted when adding/editing Qwen credentials; drives model list + rule engine.
   */
  dashscopeCompatibleBase?: string;
};

export type SlotBinding = {
  credentialId: string;
  /** Model id: e.g. models/gemini-2.0-flash (Gemini) or openai/gpt-4o-mini (OpenRouter). */
  model: string;
  /**
   * flash / pro only: max output tokens for rule-engine generation (extract / merge).
   * Omit to use engine default (env / 32768).
   */
  maxOutputTokens?: number;
  /** chat only: RAG synthesis temperature */
  temperature?: number;
  /** chat only: max tokens for assistant reply */
  maxTokens?: number;
};

/** Optional RAG / indexing overrides (rule engine falls back to env when unset). */
export type RagOptionsStored = {
  rerankModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  bm25TokenProfile?: "cjk_char" | "latin_word";
  /** Default recall pool size for new index builds (manifest stores the chosen value). */
  similarityTopK?: number;
  /** Default cap on chunks passed to the LLM after retrieval/rerank. */
  rerankTopN?: number;
  /** hybrid = BM25 + vector + RRF; vector_only = dense only (no BM25 on disk). */
  retrievalMode?: "hybrid" | "vector_only";
  /** If false, skip cross-encoder rerank (lower memory; vector or hybrid retrieval only). */
  useRerank?: boolean;
};

export type AiGatewayStored = {
  version: 1;
  credentials: AiCredentialStored[];
  slotBindings: Record<SlotKey, SlotBinding | null | undefined>;
  chatOptions: {
    temperature: number;
    maxTokens: number;
  };
  ragOptions?: RagOptionsStored;
};

export type AiCredentialPublic = {
  id: string;
  vendor: AiVendor;
  alias: string;
  hasKey: boolean;
  keyLast4: string | null;
  /** Set when vendor is qwen (normalized base URL). */
  dashscopeCompatibleBase?: string;
};

export type AiGatewayPublic = {
  version: 1;
  credentials: AiCredentialPublic[];
  slotBindings: Record<SlotKey, SlotBinding | null>;
  chatOptions: { temperature: number; maxTokens: number };
  ragOptions: RagOptionsStored;
};

export type EngineSlotFlashPro = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  /** Required when provider is qwen: OpenAI-compatible API base (no trailing slash). */
  dashscopeCompatibleBase?: string;
};

export type EngineSlotEmbed = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  dashscopeCompatibleBase?: string;
};

export type EngineSlotChat = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  dashscopeCompatibleBase?: string;
};

/** Payload sent to rule_engine (camelCase). Version 2 only. */
export type EngineAiPayloadV2 = {
  version: 2;
  slots: {
    flash: EngineSlotFlashPro;
    pro: EngineSlotFlashPro;
    embed: EngineSlotEmbed;
    chat: EngineSlotChat;
  };
  ragOptions?: RagOptionsStored;
};
