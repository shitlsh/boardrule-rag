import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { prisma } from "@/lib/prisma";
import { getStorageRoot } from "@/lib/storage";

export const runtime = "nodejs";

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

  const abs = path.join(getStorageRoot(), ...game.rulesMarkdownPath.split("/"));
  let merged: string;
  try {
    merged = await fs.readFile(abs, "utf8");
  } catch {
    return NextResponse.json({ message: "无法读取规则文件" }, { status: 400 });
  }
  if (!merged.trim()) {
    return NextResponse.json({ message: "规则文件为空" }, { status: 400 });
  }

  const base = getRuleEngineBaseUrl();
  const res = await fetch(`${base}/build-index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      game_id: game.id,
      merged_markdown: merged,
      source_file: game.slug,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json({ message: text || `建索引失败: ${res.status}` }, { status: res.status });
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
