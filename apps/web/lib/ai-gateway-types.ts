export type AiVendor = "gemini" | "openrouter" | "qwen" | "bedrock";

export const AI_VENDOR_IDS: readonly AiVendor[] = ["gemini", "openrouter", "qwen", "bedrock"];

/** How to authenticate to AWS Bedrock for this credential. */
export type BedrockAuthMode = "iam" | "api_key";

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
  /** Default true. When false, credential is hidden from slot pickers and engine resolution. */
  enabled?: boolean;
  /**
   * Model `name` values excluded from slot dropdowns for this credential (opt-out).
   * Same strings as GeminiModelOption.name (e.g. models/gemini-2.0-flash, qwen-plus).
   */
  hiddenModelIds?: string[];
  /**
   * vendor === "qwen" only: DashScope OpenAI-compatible base URL (no trailing slash).
   * Persisted when adding/editing Qwen credentials; drives model list + rule engine.
   */
  dashscopeCompatibleBase?: string;
  /**
   * vendor === "bedrock" only: AWS region for Bedrock (e.g. us-east-1).
   */
  bedrockRegion?: string;
  /**
   * vendor === "bedrock" only: IAM access keys (encrypted JSON in apiKeyEnc) vs Bedrock API key (encrypted string).
   */
  bedrockAuthMode?: BedrockAuthMode;
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

/** Persisted in `appSettings.aiGatewayJson`: credentials + global chat defaults only. */
export type AiGatewayStored = {
  version: 1;
  credentials: AiCredentialStored[];
  chatOptions: {
    temperature: number;
    maxTokens: number;
  };
};

export type AiCredentialPublic = {
  id: string;
  vendor: AiVendor;
  alias: string;
  hasKey: boolean;
  keyLast4: string | null;
  /** False when credential is disabled in UI. */
  enabled: boolean;
  /** Models hidden from slot pickers (same ids as stored). */
  hiddenModelIds: string[];
  /** Set when vendor is qwen (normalized base URL). */
  dashscopeCompatibleBase?: string;
  /** vendor === "bedrock" (public, non-secret) */
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
};

export type AiGatewayPublic = {
  version: 1;
  credentials: AiCredentialPublic[];
  chatOptions: { temperature: number; maxTokens: number };
};

export type EngineSlotFlashPro = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  /** Required when provider is qwen: OpenAI-compatible API base (no trailing slash). */
  dashscopeCompatibleBase?: string;
  /** provider === "bedrock" */
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  /** IAM only: access key id (secret is apiKey). */
  awsAccessKeyId?: string;
  awsSessionToken?: string;
};

export type EngineSlotEmbed = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  dashscopeCompatibleBase?: string;
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  awsAccessKeyId?: string;
  awsSessionToken?: string;
};

export type EngineSlotChat = {
  provider: AiVendor;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  dashscopeCompatibleBase?: string;
  bedrockRegion?: string;
  bedrockAuthMode?: BedrockAuthMode;
  awsAccessKeyId?: string;
  awsSessionToken?: string;
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

/** Optional extraction pipeline overrides (rule engine prefers these over env when set). */
export type ExtractionRuntimeOverrides = {
  visionBatchPages?: number;
  extractionSimpleMaxBodyPages?: number;
  extractionComplexRouteBodyPages?: number;
  extractionSimplePathWarnBodyPages?: number;
  /** Max page images when merging batches after NEED_MORE_CONTEXT (any vision provider). */
  visionMaxMergePages?: number;
  needMoreContextMaxExpand?: number;
  /** Use `null` to mean unlimited (engine-specific). */
  geminiHttpTimeoutMs?: number | null;
  dashscopeHttpTimeoutMs?: number | null;
  openrouterHttpTimeoutMs?: number | null;
  bedrockHttpTimeoutMs?: number | null;
  llmMaxContinuationRounds?: number;
  /** Default suggestion for full pipeline; BFF may OR with per-request `forceFullPipeline`. */
  forceFullPipelineDefault?: boolean;
};

export type EngineAiSlotsV3 = EngineAiPayloadV2["slots"] & {
  flashToc?: EngineSlotFlashPro;
  flashQuickstart?: EngineSlotFlashPro;
  proExtract?: EngineSlotFlashPro;
  proMerge?: EngineSlotFlashPro;
};

/** v3: optional fine-grained slots + extraction runtime (backward compatible when extras omitted). */
export type EngineAiPayloadV3 = {
  version: 3;
  slots: EngineAiSlotsV3;
  ragOptions?: RagOptionsStored;
  extractionRuntime?: ExtractionRuntimeOverrides;
};

export type EngineAiPayload = EngineAiPayloadV2 | EngineAiPayloadV3;
