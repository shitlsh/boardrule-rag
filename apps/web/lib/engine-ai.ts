import {
  buildEngineAiPayloadForChatAndIndex,
  buildEngineAiPayloadFromExtractionProfile,
  getAiGatewayStored,
} from "@/lib/ai-gateway";
import {
  getActiveChatProfileConfig,
  getExtractionProfileConfigById,
  resolveIndexProfileConfigForEngine,
} from "@/lib/ai-runtime-profiles";

export const BOARDRULE_AI_CONFIG_HEADER = "X-Boardrule-Ai-Config";

export type RuleEngineAiHeaderOptions = {
  /** When `"extraction"`, builds v3 payload for `POST /extract` (requires `extractionProfileId`). */
  mode?: "default" | "extraction";
  /** EXTRACTION profile id from DB (required when `mode === "extraction"`). */
  extractionProfileId?: string | null;
  /**
   * When set, INDEX template (embed + ragOptions) resolves from `Game.indexProfileId` or site default.
   * Omit for extraction-only headers (uses site default INDEX template).
   */
  gameId?: string | null;
};

/**
 * Headers for rule_engine calls that need the AI gateway payload.
 * Default mode merges the active CHAT profile (if any) for chat + build-index + smoke tests.
 */
export async function getEngineAiHeaders(opts?: RuleEngineAiHeaderOptions): Promise<Record<string, string>> {
  const stored = await getAiGatewayStored();
  const chat = await getActiveChatProfileConfig();
  if (!chat) {
    throw new Error(
      "请先在「模型管理 → 聊天模型」创建并选择全局生效的聊天模版（不再使用网关内 Chat 槽）。",
    );
  }
  const indexForPayload = await resolveIndexProfileConfigForEngine(opts?.gameId ?? null);
  if (!indexForPayload) {
    throw new Error(
      "请先在「模型管理 → 索引配置」创建索引模版（Embed + 检索参数），并设置全站默认。",
    );
  }
  const mode = opts?.mode ?? "default";
  if (mode === "extraction") {
    const id = opts?.extractionProfileId?.trim() ?? "";
    if (!id) {
      throw new Error("缺少 extractionProfileId（请在游戏页选择提取模版）");
    }
    const profile = await getExtractionProfileConfigById(id);
    if (!profile) {
      throw new Error("提取配置模版不存在或内容无效");
    }
    const payload = buildEngineAiPayloadFromExtractionProfile(stored, profile, chat, indexForPayload);
    return {
      [BOARDRULE_AI_CONFIG_HEADER]: JSON.stringify(payload),
    };
  }
  const payload = await buildEngineAiPayloadForChatAndIndex(stored, chat, indexForPayload);
  return {
    [BOARDRULE_AI_CONFIG_HEADER]: JSON.stringify(payload),
  };
}
