/**
 * Chat SSE protocol (must stay aligned with rule_engine `POST /chat/stream` and Next `POST /api/chat/stream`).
 *
 * Transport: HTTP `text/event-stream`, each event is one line:
 *   data: {"type":"phase","id":"prepare"|"search"|"organize"|"clarify"|"answer"}\n\n
 *   data: {"type":"delta","text":"..."}\n\n
 *   data: {"type":"sources","sources":[...]}\n\n
 *   data: {"type":"done"}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 *
 * Phase `id` values are machine-readable; UI maps them to user-facing copy (see product plan).
 */
export type ChatSsePhaseId = "prepare" | "search" | "organize" | "clarify" | "answer";

export type ChatSseEvent =
  | { type: "phase"; id: ChatSsePhaseId }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: unknown[] }
  | { type: "done" }
  | { type: "error"; message: string };

/** User-visible labels (Chinese) — keep in sync with product copy. */
export const CHAT_PHASE_LABEL_ZH: Record<ChatSsePhaseId, string> = {
  prepare: "正在准备规则内容…",
  search: "正在查找与你的问题相关的规则…",
  organize: "正在整理规则要点…",
  clarify: "正在结合上面的对话，理解你想问什么…",
  answer: "正在生成回答…",
};
