export type AiVendor = "gemini";

export type SlotKey = "flash" | "pro" | "embed" | "chat";

export type AiCredentialStored = {
  id: string;
  vendor: AiVendor;
  /** Globally unique (case-insensitive after trim). */
  alias: string;
  apiKeyEnc: string;
};

export type SlotBinding = {
  credentialId: string;
  /** Full model resource name or id, e.g. models/gemini-2.0-flash */
  model: string;
};

/** Optional RAG / indexing overrides (rule engine falls back to env when unset). */
export type RagOptionsStored = {
  rerankModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  bm25TokenProfile?: "cjk_char" | "latin_word";
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
};

export type AiGatewayPublic = {
  version: 1;
  credentials: AiCredentialPublic[];
  slotBindings: Record<SlotKey, SlotBinding | null>;
  chatOptions: { temperature: number; maxTokens: number };
  ragOptions: RagOptionsStored;
};

/** Payload sent to rule_engine (camelCase). */
export type EngineAiPayloadV1 = {
  version: 1;
  gemini: {
    flash: { apiKey: string; model: string; maxOutputTokens?: number };
    pro: { apiKey: string; model: string; maxOutputTokens?: number };
    embed: { apiKey: string; model: string };
    chat: { apiKey: string; model: string; temperature: number; maxTokens: number };
  };
  ragOptions?: RagOptionsStored;
};
