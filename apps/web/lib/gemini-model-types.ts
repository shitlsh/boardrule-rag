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
  /**
   * Heuristic: likely supports image / multimodal (UI). When a row exists in vendored Dify YAML,
   * enrichment overwrites this from `supportsVision`.
   */
  visionHint: boolean;
  /** Dify plugin `model_properties.mode` (e.g. chat, embedding) when this model id matched YAML. */
  modelMode?: string;
  /** Dify plugin features include vision/video — authoritative when set by enrichment. */
  supportsVision?: boolean;
};
