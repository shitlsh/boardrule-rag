import { z } from "zod";

/** Single slot: credential + model (+ optional per-slot limits). */
export const slotBindingSchema = z
  .object({
    credentialId: z.string().min(1),
    model: z.string().min(1),
    maxOutputTokens: z.number().int().positive().optional(),
    temperature: z.number().finite().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

export type SlotBindingParsed = z.infer<typeof slotBindingSchema>;

/** Index rerank: local HF cross-encoder or Jina API (separate from Embed slot). */
export const indexRerankConfigSchema = z.discriminatedUnion("backend", [
  z
    .object({
      backend: z.literal("local"),
      model: z.string().min(1),
    })
    .strict(),
  z
    .object({
      backend: z.literal("jina"),
      credentialId: z.string().min(1),
      model: z.string().min(1),
    })
    .strict(),
]);

export type IndexRerankConfigParsed = z.infer<typeof indexRerankConfigSchema>;

export const ragOptionsStoredSchema = z
  .object({
    /** @deprecated Prefer `rerank` on index profile; kept for migration / engine fallback. */
    rerankModel: z.string().optional(),
    chunkSize: z.number().int().positive().optional(),
    chunkOverlap: z.number().int().min(0).optional(),
    bm25TokenProfile: z.enum(["cjk_char", "latin_word"]).optional(),
    similarityTopK: z.number().int().min(1).max(200).optional(),
    rerankTopN: z.number().int().min(1).max(100).optional(),
    retrievalMode: z.enum(["hybrid", "vector_only"]).optional(),
    useRerank: z.boolean().optional(),
  })
  .strict()
  .partial();

export const extractionRuntimeOverridesSchema = z
  .object({
    visionBatchPages: z.number().int().min(1).max(64).optional(),
    extractionSimpleMaxBodyPages: z.number().int().min(1).max(500).optional(),
    extractionSimplePathWarnBodyPages: z.number().int().min(1).max(500).optional(),
    visionMaxMergePages: z.number().int().min(1).max(200).optional(),
    needMoreContextMaxExpand: z.number().int().min(0).max(64).optional(),
    /** ms; 0 allowed (engine maps to provider-specific “unlimited” / fallback). */
    geminiHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    dashscopeHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    openrouterHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    bedrockHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    claudeHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    jinaHttpTimeoutMs: z.union([z.number().int().min(0), z.null()]).optional(),
    llmMaxContinuationRounds: z.number().int().min(0).max(32).optional(),
    forceFullPipelineDefault: z.boolean().optional(),
  })
  .passthrough();

const fineSlotNullable = slotBindingSchema.nullable();

export const extractionProfileConfigSchema = z
  .object({
    slotBindings: z
      .object({
        flashToc: fineSlotNullable.optional(),
        flashQuickstart: fineSlotNullable.optional(),
        proExtract: fineSlotNullable.optional(),
        proMerge: fineSlotNullable.optional(),
      })
      .strict(),
    extractionRuntime: extractionRuntimeOverridesSchema.optional(),
    forceFullPipelineDefault: z.boolean().optional(),
  })
  .strict();

/** RAG rulebook chat: condense history cap + heuristic skip threshold (defaults applied in BFF when omitted). */
export const ragChatOptionsSchema = z
  .object({
    /** How many full user+assistant rounds of prior messages to keep (server truncates). Default 3. */
    maxPriorTurns: z.number().int().min(1).max(20).optional(),
    /** Min chars on current user message to allow skipping condense when no temporal cues. Default 15. */
    skipCondenseMinChars: z.number().int().min(1).max(500).optional(),
  })
  .strict();

/** Chat templates: conversation slot only. */
export const chatProfileConfigSchema = z
  .object({
    chat: slotBindingSchema,
    ragChat: ragChatOptionsSchema.optional(),
  })
  .strict();

/** INDEX templates: vector embed + optional RAG / chunk defaults for indexing and per-game retrieval. */
export const indexProfileConfigSchema = z
  .object({
    embed: slotBindingSchema,
    /** When omitted, parse step may derive from legacy `ragOptions.rerankModel`. */
    rerank: indexRerankConfigSchema.optional(),
    ragOptions: ragOptionsStoredSchema.optional(),
  })
  .strict();

/** Legacy persisted shape (pre-merge); used only to accept old DB rows when parsing. */
const legacyChatProfileWithRagSchema = z
  .object({
    chat: slotBindingSchema,
    ragOptions: ragOptionsStoredSchema.optional(),
  })
  .strict();

export type ExtractionProfileConfigParsed = z.infer<typeof extractionProfileConfigSchema>;
export type ChatProfileConfigParsed = z.infer<typeof chatProfileConfigSchema>;
export type IndexProfileConfigParsed = z.infer<typeof indexProfileConfigSchema>;

function migrateIndexProfileRaw(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  const embed = o.embed;
  if (!embed || typeof embed !== "object") return data;
  if (o.rerank !== undefined) return data;
  const ro = o.ragOptions;
  if (!ro || typeof ro !== "object") return data;
  const rm = (ro as Record<string, unknown>).rerankModel;
  if (typeof rm !== "string" || !rm.trim()) return data;
  return {
    ...o,
    rerank: { backend: "local", model: rm.trim() },
  };
}
export type ExtractionRuntimeOverridesParsed = z.infer<typeof extractionRuntimeOverridesSchema>;

export function parseExtractionProfileConfigJson(raw: string): ExtractionProfileConfigParsed {
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw new Error("配置 JSON 无效");
  }
  return extractionProfileConfigSchema.parse(data);
}

export function parseChatProfileConfigJson(raw: string): ChatProfileConfigParsed {
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw new Error("配置 JSON 无效");
  }
  const legacy = legacyChatProfileWithRagSchema.safeParse(data);
  if (legacy.success) {
    return { chat: legacy.data.chat };
  }
  return chatProfileConfigSchema.parse(data);
}

export function safeParseExtractionProfileConfigJson(
  raw: string,
): ExtractionProfileConfigParsed | null {
  try {
    return parseExtractionProfileConfigJson(raw);
  } catch {
    return null;
  }
}

export function safeParseChatProfileConfigJson(raw: string): ChatProfileConfigParsed | null {
  try {
    return parseChatProfileConfigJson(raw);
  } catch {
    return null;
  }
}

export function parseIndexProfileConfigJson(raw: string): IndexProfileConfigParsed {
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw new Error("配置 JSON 无效");
  }
  return indexProfileConfigSchema.parse(migrateIndexProfileRaw(data));
}

export function safeParseIndexProfileConfigJson(raw: string): IndexProfileConfigParsed | null {
  try {
    return parseIndexProfileConfigJson(raw);
  } catch {
    return null;
  }
}
