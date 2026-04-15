/**
 * Normalized model row for AI Gateway slot pickers (any vendor: Gemini, OpenRouter, Qwen, …).
 * Enrichment may fill fields from vendored plugin YAML (`dify-model-metadata.json`).
 */
export type AiModelOption = {
  /** Resource id sent to the provider API, e.g. models/gemini-2.0-flash or openai/gpt-4o */
  name: string;
  /** Human label from the provider or metadata */
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  capabilities: {
    generateContent: boolean;
    embedContent: boolean;
  };
  /**
   * Heuristic: likely supports image / multimodal (UI). When a row exists in vendored YAML,
   * enrichment overwrites this from `supportsVision`.
   */
  visionHint: boolean;
  /** Plugin `model_properties.mode` (e.g. chat, embedding) when this model id matched YAML. */
  modelMode?: string;
  /** Plugin features include vision/video — authoritative when set by enrichment. */
  supportsVision?: boolean;
};
