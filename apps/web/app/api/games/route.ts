import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { uniqueSlugForGame } from "@/lib/slug";

export async function GET() {
  const games = await prisma.game.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { tasks: true } },
    },
  });
  return NextResponse.json({ games });
}

export async function POST(req: Request) {
  let body: { name?: string; coverUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const slug = await uniqueSlugForGame(name);
  const game = await prisma.game.create({
    data: {
      name,
      slug,
      coverUrl: body.coverUrl?.trim() || null,
    },
  });
  return NextResponse.json({ game }, { status: 201 });
}
