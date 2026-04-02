import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { chatRules } from "@/lib/ingestion/client";

type ChatBody = {
  gameId?: string;
  message?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
};

/**
 * C-side RAG chat: proxies to rule_engine `POST /chat` (LlamaIndex QueryEngine + hybrid + rerank).
 * Requires an index for the game (`POST /build-index` / Phase 2).
 */
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!gameId || !message) {
    return NextResponse.json({ error: "gameId and message are required" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : undefined;
  if (messages) {
    for (const m of messages) {
      if (
        !m ||
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        !m.content.trim()
      ) {
        return NextResponse.json({ error: "Invalid messages[] entries" }, { status: 400 });
      }
    }
  }

  try {
    const result = await chatRules({
      gameId,
      message,
      messages: messages?.map((m) => ({
        role: m.role,
        content: m.content.trim(),
      })),
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat request failed";
    const isNotFound = /404|not found|No vector index/i.test(msg);
    return NextResponse.json(
      { error: msg },
      { status: isNotFound ? 404 : 502 },
    );
  }
}
