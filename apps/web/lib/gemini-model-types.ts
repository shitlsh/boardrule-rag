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
};
