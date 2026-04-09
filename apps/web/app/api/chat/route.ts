import { NextResponse } from "next/server";

import { chatRules, getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { prisma } from "@/lib/prisma";
import { getCEndChatLimitsPublic } from "@/lib/c-end-chat-settings";
import { getClientIp } from "@/lib/client-ip";
import { assertStaffOrMiniapp } from "@/lib/request-auth";
import { checkAndIncrementMiniappChatLimits, MiniappChatRateLimitError } from "@/lib/rate-limit";
import type { ChatMessage } from "@/lib/types";

/** Same idea as build-index: first chat may load cross-encoder weights (sentence-transformers) + RAG + Gemini. */
export const runtime = "nodejs";
export const maxDuration = 300;

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
  const gate = await assertStaffOrMiniapp(req);
  if (!("kind" in gate)) return gate;

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

  if (process.env.NODE_ENV === "development") {
    console.info("[api/chat] request", { gameId });
  }

  // ── C-end rate limits: per-IP + global daily (miniapp JWT only; staff unlimited) ─
  if (gate.kind === "miniapp") {
    try {
      const { dailyChatLimitPerIp, dailyChatLimitGlobal } = await getCEndChatLimitsPublic();
      const clientIp = getClientIp(req);
      await checkAndIncrementMiniappChatLimits(
        clientIp,
        dailyChatLimitPerIp,
        dailyChatLimitGlobal,
      );
    } catch (e) {
      if (e instanceof MiniappChatRateLimitError) {
        return NextResponse.json({ message: e.message }, { status: 429 });
      }
      // DB / transaction errors — fail open
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  const indexBuildInFlight = await prisma.task.findFirst({
    where: {
      gameId,
      type: "INDEX_BUILD",
      status: { in: ["PENDING", "PROCESSING"] },
    },
    select: { id: true },
  });
  if (indexBuildInFlight) {
    return NextResponse.json(
      { message: "索引正在建立或更新中，请稍后再试。可在游戏详情页查看任务进度。" },
      { status: 409 },
    );
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

  if (process.env.NODE_ENV === "development") {
    console.info("[api/chat] calling rule engine", {
      base: getRuleEngineBaseUrl(),
      gameId,
    });
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
