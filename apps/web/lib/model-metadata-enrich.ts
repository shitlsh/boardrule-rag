/**
 * Optional metadata overlays for model pickers (mode / context / vision badges).
 * Dify official plugins (YAML → dify-model-metadata.json): tongyi, gemini, openrouter.
 */

import type { AiVendor } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

import { enrichModelsWithDifyMetadata } from "@/lib/dify-model-metadata-registry";

export function enrichModelMetadata(vendor: AiVendor, models: GeminiModelOption[]): GeminiModelOption[] {
  return enrichModelsWithDifyMetadata(vendor, models);
}
