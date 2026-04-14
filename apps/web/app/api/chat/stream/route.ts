import { NextResponse } from "next/server";

import { fetchChatRulesStream, getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { prisma } from "@/lib/prisma";
import { getCEndChatLimitsPublic } from "@/lib/c-end-chat-settings";
import { getClientIp } from "@/lib/client-ip";
import { assertStaffOrMiniapp } from "@/lib/request-auth";
import { checkAndIncrementMiniappChatLimits, MiniappChatRateLimitError } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatBody = {
  gameId?: string;
  message?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
};

/**
 * SSE proxy to rule_engine `POST /chat/stream`. Same auth / rate limits / index gates as other chat routes.
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
    console.info("[api/chat/stream] request", { gameId });
  }

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
    }
  }

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
    console.info("[api/chat/stream] calling rule engine", {
      base: getRuleEngineBaseUrl(),
      gameId,
    });
  }

  let upstream: Response;
  try {
    upstream = await fetchChatRulesStream({
      gameId,
      message,
      messages: messages?.map((m) => ({
        role: m.role,
        content: m.content.trim(),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat stream request failed";
    return NextResponse.json({ message: msg }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const isNotFound = upstream.status === 404 || /not found|No vector index/i.test(text);
    return NextResponse.json(
      { message: text || "Chat stream failed" },
      { status: isNotFound ? 404 : upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
