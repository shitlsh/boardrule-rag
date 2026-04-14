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

export const ragOptionsStoredSchema = z
  .object({
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

/** Chat templates: conversation slot only. */
export const chatProfileConfigSchema = z
  .object({
    chat: slotBindingSchema,
  })
  .strict();

/** INDEX templates: vector embed + optional RAG / chunk defaults for indexing and per-game retrieval. */
export const indexProfileConfigSchema = z
  .object({
    embed: slotBindingSchema,
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
  return indexProfileConfigSchema.parse(data);
}

export function safeParseIndexProfileConfigJson(raw: string): IndexProfileConfigParsed | null {
  try {
    return parseIndexProfileConfigJson(raw);
  } catch {
    return null;
  }
}
