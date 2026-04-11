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
  /** From LiteLLM registry when matched (e.g. chat, embedding). */
  litellmMode?: string;
  /** From LiteLLM max_input_tokens when matched. */
  litellmMaxInputTokens?: number;
  /** From LiteLLM max_output_tokens when matched. */
  litellmMaxOutputTokens?: number;
  /** From LiteLLM supports_vision when matched; overrides heuristic for badge when set. */
  supportsVision?: boolean;
};
