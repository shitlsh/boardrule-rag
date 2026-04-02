import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getStorageRoot } from "@/lib/storage";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (!game.rulesMarkdownPath) {
    return NextResponse.json({ markdown: null });
  }
  const abs = path.join(getStorageRoot(), game.rulesMarkdownPath);
  try {
    const markdown = await fs.readFile(abs, "utf8");
    return NextResponse.json({ markdown });
  } catch {
    return NextResponse.json({ error: "Could not read rules file" }, { status: 400 });
  }
}
