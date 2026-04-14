import type { ChatSseEvent } from "@/lib/chat-sse-protocol";

/** Incremental buffer for SSE frames split across fetch chunks. */
export type SseBuffer = { text: string };

export function createSseBuffer(): SseBuffer {
  return { text: "" };
}

/**
 * Append UTF-8 text from a stream chunk and emit parsed JSON events (``data: {...}\\n`` blocks).
 */
export function feedSseBuffer(
  buffer: SseBuffer,
  chunk: string,
  onEvent: (event: ChatSseEvent) => void,
): void {
  buffer.text += chunk;
  // Events end with blank line (\n\n)
  for (;;) {
    const sep = buffer.text.indexOf("\n\n");
    if (sep < 0) break;
    const block = buffer.text.slice(0, sep);
    buffer.text = buffer.text.slice(sep + 2);
    const lines = block.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as ChatSseEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

/**
 * After the byte stream ends, parse any remaining text (e.g. last `data:` line not
 * followed by a blank line). Prevents the client from waiting forever if the server
 * closed the socket mid-frame.
 */
export function flushSseBufferTail(
  buffer: SseBuffer,
  onEvent: (event: ChatSseEvent) => void,
): void {
  const raw = buffer.text;
  if (!raw.trim()) {
    buffer.text = "";
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      onEvent(JSON.parse(payload) as ChatSseEvent);
    } catch {
      /* ignore */
    }
  }
  buffer.text = "";
}
