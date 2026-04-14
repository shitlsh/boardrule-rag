import { NextResponse } from "next/server";

import { gameHasActiveIndexBuild, prismaGameToDetailDto, prismaGameToDto } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";
import { assertStaffOrMiniapp, assertStaffSession } from "@/lib/request-auth";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const gate = await assertStaffOrMiniapp(req);
  if (!("kind" in gate)) return gate;

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
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const existing = await prisma.game.findUnique({ where: { id: gameId } });
  if (!existing) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  let body: {
    name?: string;
    coverUrl?: string | null;
    pageMetadataEnabled?: boolean;
    indexProfileId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  if (body.indexProfileId !== undefined && body.indexProfileId !== null && body.indexProfileId.trim()) {
    const prof = await prisma.aiRuntimeProfile.findUnique({
      where: { id: body.indexProfileId.trim() },
    });
    if (!prof || prof.kind !== "INDEX") {
      return NextResponse.json({ message: "索引模版不存在或类型不是 INDEX" }, { status: 400 });
    }
  }
  const game = await prisma.game.update({
    where: { id: gameId },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
      ...(body.pageMetadataEnabled !== undefined
        ? { pageMetadataEnabled: Boolean(body.pageMetadataEnabled) }
        : {}),
      ...(body.indexProfileId !== undefined
        ? {
            indexProfileId:
              body.indexProfileId === null || body.indexProfileId === ""
                ? null
                : body.indexProfileId.trim(),
          }
        : {}),
    },
  });
  const indexBuilding = await gameHasActiveIndexBuild(gameId);
  return NextResponse.json(prismaGameToDto(game, undefined, { indexBuilding }));
}
