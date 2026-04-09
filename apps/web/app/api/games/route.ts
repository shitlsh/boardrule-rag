import { NextResponse } from "next/server";

import { gameIdsWithActiveIndexBuild, prismaGameToDto } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";
import { assertStaffOrMiniapp, assertStaffSession } from "@/lib/request-auth";
import { uniqueSlugForGame } from "@/lib/slug";

export async function GET(req: Request) {
  const gate = await assertStaffOrMiniapp(req);
  if (!("kind" in gate)) return gate;
  const games = await prisma.game.findMany({
    orderBy: { updatedAt: "desc" },
  });
  const buildingIds = await gameIdsWithActiveIndexBuild(games.map((g) => g.id));
  return NextResponse.json(
    games.map((g) => prismaGameToDto(g, undefined, { indexBuilding: buildingIds.has(g.id) })),
  );
}

export async function POST(req: Request) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  let body: { name?: string; coverUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ message: "请输入游戏名称" }, { status: 400 });
  }
  const slug = await uniqueSlugForGame(name);
  const game = await prisma.game.create({
    data: {
      name,
      slug,
      coverUrl: body.coverUrl?.trim() || null,
    },
  });
  return NextResponse.json({ game: prismaGameToDto(game) }, { status: 201 });
}
