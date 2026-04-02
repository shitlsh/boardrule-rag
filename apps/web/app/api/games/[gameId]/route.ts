import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteParams = { params: { gameId: string } };

export async function GET(_req: Request, { params }: RouteParams) {
  const { gameId } = params;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      tasks: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  return NextResponse.json({ game });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { gameId } = params;
  const existing = await prisma.game.findUnique({ where: { id: gameId } });
  if (!existing) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  let body: { name?: string; coverUrl?: string | null; pageMetadataEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
  return NextResponse.json({ game });
}
