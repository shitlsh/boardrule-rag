import { NextResponse } from "next/server";

import { prismaGameToDto } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";
import { uniqueSlugForGame } from "@/lib/slug";

export async function GET() {
  const games = await prisma.game.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(games.map((g) => prismaGameToDto(g)));
}

export async function POST(req: Request) {
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
