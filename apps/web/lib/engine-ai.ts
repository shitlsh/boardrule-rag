import { getEngineAiPayloadOrThrow } from "@/lib/ai-gateway";

export const BOARDRULE_AI_CONFIG_HEADER = "X-Boardrule-Ai-Config";

/** Headers to pass to rule_engine for any route that invokes Gemini. */
export async function getEngineAiHeaders(): Promise<Record<string, string>> {
  const payload = await getEngineAiPayloadOrThrow();
  return {
    [BOARDRULE_AI_CONFIG_HEADER]: JSON.stringify(payload),
  };
}
