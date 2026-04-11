export type GeminiModelOption = {
  /** Resource name, e.g. models/gemini-2.0-flash — value sent to API */
  name: string;
  /** Human label from Google */
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  capabilities: {
    generateContent: boolean;
    embedContent: boolean;
  };
  /** Heuristic: likely supports image / multimodal inputs (for UI badge only) */
  visionHint: boolean;
  /** Overlay mode when matched (e.g. chat, embedding) — Dify plugin YAML (tongyi / gemini / openrouter). */
  litellmMode?: string;
  /** Overlay max input tokens — Dify `context_size`. */
  litellmMaxInputTokens?: number;
  /** Overlay max output tokens — Dify parameter_rules max when present. */
  litellmMaxOutputTokens?: number;
  /** Overlay: vision — Dify features (vision/video). */
  supportsVision?: boolean;
};
