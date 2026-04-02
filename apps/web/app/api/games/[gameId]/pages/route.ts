import { NextResponse } from "next/server";

import { pagePreviewToThumbnails } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, pagePreviewJson: true },
  });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  return NextResponse.json(pagePreviewToThumbnails(game.pagePreviewJson));
}
