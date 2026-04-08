import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { getEngineAiHeaders } from "@/lib/engine-ai";
import { prisma } from "@/lib/prisma";
import { readStorageText } from "@/lib/storage";

export const runtime = "nodejs";
/** Vercel / 部分托管：允许较长建索引时间（向量 + BM25 + 可选 rerank 模型加载）。 */
export const maxDuration = 300;

function messageFromRuleEngineBody(text: string, status: number): string {
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const parts = j.detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "";
      });
      const s = parts.filter(Boolean).join("; ");
      if (s) return s;
    }
  } catch {
    /* not JSON */
  }
  return trimmed || `建索引失败 (${status})`;
}

type RouteParams = { params: Promise<{ gameId: string }> };

export async function POST(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  if (!game.rulesMarkdownPath) {
    return NextResponse.json({ message: "尚未提取规则正文，无法建索引" }, { status: 400 });
  }

  const merged = await readStorageText(game.rulesMarkdownPath);
  if (merged === undefined) {
    return NextResponse.json({ message: "无法读取规则文件" }, { status: 400 });
  }
  if (!merged.trim()) {
    return NextResponse.json({ message: "规则文件为空" }, { status: 400 });
  }

  const base = getRuleEngineBaseUrl();
  let ai: Record<string, string>;
  try {
    ai = await getEngineAiHeaders();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        message: `AI 配置不完整，无法建索引：${msg}。请在「/models」中配置凭证并为 Flash / Pro / Embed / Chat 槽位选择模型后保存。`,
      },
      { status: 400 },
    );
  }
  const res = await fetch(`${base}/build-index`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ai },
    body: JSON.stringify({
      game_id: game.id,
      merged_markdown: merged,
      source_file: game.slug,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { message: messageFromRuleEngineBody(text, res.status) },
      { status: res.status },
    );
  }

  const body = JSON.parse(text) as { index_id?: string; manifest?: { game_id?: string } };
  const indexId = body.index_id ?? body.manifest?.game_id ?? game.id;

  await prisma.game.update({
    where: { id: game.id },
    data: {
      indexId,
      vectorStoreId: indexId,
    },
  });

  return NextResponse.json({
    message: "索引建立成功",
    indexId,
  });
}
