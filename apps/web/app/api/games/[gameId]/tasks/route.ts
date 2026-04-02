import { NextResponse } from "next/server";

import { prismaTaskToExtractionTask } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";
import { syncTaskFromRuleEngine } from "@/lib/ingestion";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  const tasks = await prisma.task.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  for (const t of tasks) {
    if (t.status === "PROCESSING" && t.jobId) {
      await syncTaskFromRuleEngine(t.id);
    }
  }

  const refreshed = await prisma.task.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json(refreshed.map(prismaTaskToExtractionTask));
}
