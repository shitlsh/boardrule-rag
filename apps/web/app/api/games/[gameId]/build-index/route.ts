import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { prisma } from "@/lib/prisma";
import { getStorageRoot } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Reads merged rules Markdown from storage and calls the rule engine `POST /build-index`.
 */
type RouteParams = { params: Promise<{ gameId: string }> };

export async function POST(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (!game.rulesMarkdownPath) {
    return NextResponse.json({ error: "No extracted rules yet (rulesMarkdownPath is empty)" }, { status: 400 });
  }

  const abs = path.join(getStorageRoot(), ...game.rulesMarkdownPath.split("/"));
  let merged: string;
  try {
    merged = await fs.readFile(abs, "utf8");
  } catch {
    return NextResponse.json({ error: "Could not read rules markdown from storage" }, { status: 400 });
  }
  if (!merged.trim()) {
    return NextResponse.json({ error: "Rules markdown file is empty" }, { status: 400 });
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
    return NextResponse.json({ error: text || `Build index failed: ${res.status}` }, { status: res.status });
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

  return NextResponse.json({ ok: true, indexId, raw: body });
}
