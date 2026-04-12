import { getEngineAiHeaders, type RuleEngineAiHeaderOptions } from "@/lib/engine-ai";

/** Service-to-service auth for rule_engine (see `RULE_ENGINE_API_KEY`). */
export function ruleEngineBearerAuth(): Record<string, string> {
  const key = process.env.RULE_ENGINE_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RULE_ENGINE_API_KEY is required in production");
    }
    return {};
  }
  return { Authorization: `Bearer ${key}` };
}

/** AI config headers plus optional Bearer API key. */
export async function ruleEngineAiHeaders(opts?: RuleEngineAiHeaderOptions): Promise<Record<string, string>> {
  const ai = await getEngineAiHeaders(opts);
  return { ...ruleEngineBearerAuth(), ...ai };
}
