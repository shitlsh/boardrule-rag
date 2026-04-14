/**
 * Must match `apps/web/lib/chat-sse-protocol.ts` and rule_engine SSE payloads.
 */
export type ChatSsePhaseId = 'prepare' | 'search' | 'organize' | 'clarify' | 'answer'

export type ChatSseEvent =
  | { type: 'phase'; id: ChatSsePhaseId }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: unknown[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

export const CHAT_PHASE_LABEL_ZH: Record<ChatSsePhaseId, string> = {
  prepare: '正在准备规则内容…',
  search: '正在查找与你的问题相关的规则…',
  organize: '正在整理规则要点…',
  clarify: '正在结合上面的对话，理解你想问什么…',
  answer: '正在生成回答…',
}

export type SseBuffer = { text: string }

export function createSseBuffer(): SseBuffer {
  return { text: '' }
}

export function feedSseBuffer(
  buffer: SseBuffer,
  chunk: string,
  onEvent: (event: ChatSseEvent) => void,
): void {
  buffer.text += chunk
  for (;;) {
    const sep = buffer.text.indexOf('\n\n')
    if (sep < 0) break
    const block = buffer.text.slice(0, sep)
    buffer.text = buffer.text.slice(sep + 2)
    const lines = block.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      try {
        onEvent(JSON.parse(raw) as ChatSseEvent)
      } catch {
        /* ignore */
      }
    }
  }
}
