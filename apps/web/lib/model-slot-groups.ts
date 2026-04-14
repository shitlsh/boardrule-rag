import type { SlotKey } from "@/lib/ai-gateway-types";

/** Flash + Pro — 规则书提取管线 */
export const MODEL_SLOTS_EXTRACTION: SlotKey[] = ["flash", "pro"];

/** Chat — RAG 对话合成 */
export const MODEL_SLOTS_CHAT: SlotKey[] = ["chat"];

/** Embed — 向量与建索引 */
export const MODEL_SLOTS_INDEX: SlotKey[] = ["embed"];
