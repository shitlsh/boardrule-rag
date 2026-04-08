import { NextResponse } from "next/server";

import { gameHasActiveIndexBuild, prismaGameToDetailDto, prismaGameToDto } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
  });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  const dto = await prismaGameToDetailDto(game);
  return NextResponse.json(dto);
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const existing = await prisma.game.findUnique({ where: { id: gameId } });
  if (!existing) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  let body: { name?: string; coverUrl?: string | null; pageMetadataEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const game = await prisma.game.update({
    where: { id: gameId },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
      ...(body.pageMetadataEnabled !== undefined
        ? { pageMetadataEnabled: Boolean(body.pageMetadataEnabled) }
        : {}),
    },
  });
  const indexBuilding = await gameHasActiveIndexBuild(gameId);
  return NextResponse.json(prismaGameToDto(game, undefined, { indexBuilding }));
}
