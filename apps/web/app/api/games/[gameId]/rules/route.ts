import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import { readStorageText } from "@/lib/storage";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (!game.rulesMarkdownPath) {
    return NextResponse.json({ markdown: null });
  }
  const markdown = await readStorageText(game.rulesMarkdownPath);
  if (markdown === undefined) {
    return NextResponse.json({ error: "Could not read rules file" }, { status: 400 });
  }
  return NextResponse.json({ markdown });
}
