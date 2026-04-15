/**
 * Optional metadata overlays for model pickers (mode / context / vision badges).
 * Source: vendored plugin YAML aggregated into `dify-model-metadata.json` (see sync script).
 */

import type { AiVendor } from "@/lib/ai-gateway-types";
import type { AiModelOption } from "@/lib/ai-model-option";

import { enrichModelsWithDifyMetadata } from "@/lib/dify-model-metadata-registry";

export function enrichModelMetadata(vendor: AiVendor, models: AiModelOption[]): AiModelOption[] {
  return enrichModelsWithDifyMetadata(vendor, models);
}
