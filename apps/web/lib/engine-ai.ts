import {
  buildEngineAiPayloadForChatAndIndex,
  buildEngineAiPayloadFromExtractionProfile,
  getAiGatewayStored,
} from "@/lib/ai-gateway";
import { getActiveChatProfileConfig, getExtractionProfileConfigById } from "@/lib/ai-runtime-profiles";

export const BOARDRULE_AI_CONFIG_HEADER = "X-Boardrule-Ai-Config";

export type RuleEngineAiHeaderOptions = {
  /** When `"extraction"`, builds v2/v3 payload for `POST /extract` (optional `extractionProfileId`). */
  mode?: "default" | "extraction";
  /** EXTRACTION profile id from DB; omit or empty = legacy single-slot v2 payload. */
  extractionProfileId?: string | null;
};

/**
 * Headers for rule_engine calls that need the AI gateway payload.
 * Default mode merges the active CHAT profile (if any) for chat + build-index + smoke tests.
 */
export async function getEngineAiHeaders(opts?: RuleEngineAiHeaderOptions): Promise<Record<string, string>> {
  const stored = await getAiGatewayStored();
  const mode = opts?.mode ?? "default";
  if (mode === "extraction") {
    const id = opts?.extractionProfileId?.trim() ?? "";
    const profile = id ? await getExtractionProfileConfigById(id) : null;
    if (id && !profile) {
      throw new Error("提取配置模版不存在或内容无效");
    }
    const payload = buildEngineAiPayloadFromExtractionProfile(stored, profile);
    return {
      [BOARDRULE_AI_CONFIG_HEADER]: JSON.stringify(payload),
    };
  }
  const chat = await getActiveChatProfileConfig();
  const payload = buildEngineAiPayloadForChatAndIndex(stored, chat);
  return {
    [BOARDRULE_AI_CONFIG_HEADER]: JSON.stringify(payload),
  };
}
