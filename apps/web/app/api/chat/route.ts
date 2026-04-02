import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { chatRules } from "@/lib/ingestion/client";
import type { ChatMessage } from "@/lib/types";

type ChatBody = {
  gameId?: string;
  message?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
};

/**
 * C-side RAG chat: proxies to rule_engine `POST /chat` (LlamaIndex QueryEngine + hybrid + rerank).
 * Response includes `message` for the v0 chat UI and `answer` / `sources` for compatibility.
 */
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!gameId || !message) {
    return NextResponse.json({ message: "gameId and message are required" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  if (!game.indexId && !game.vectorStoreId) {
    return NextResponse.json(
      { message: "尚未建立规则索引。请在游戏详情页提取完成后点击「建立索引」。" },
      { status: 409 },
    );
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
        return NextResponse.json({ message: "Invalid messages[] entries" }, { status: 400 });
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

    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.answer,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      message: assistant,
      answer: result.answer,
      game_id: result.game_id,
      sources: result.sources,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat request failed";
    const isNotFound = /404|not found|No vector index/i.test(msg);
    return NextResponse.json({ message: msg }, { status: isNotFound ? 404 : 502 });
  }
}
