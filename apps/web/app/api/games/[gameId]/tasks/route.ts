import { NextResponse } from "next/server";

import { prismaTaskToExtractionTask } from "@/lib/game-dto";
import { prisma } from "@/lib/prisma";
import { syncIndexBuildTask, syncTaskFromRuleEngine } from "@/lib/ingestion";

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

  const processing = tasks.filter((t) => t.status === "PROCESSING" && t.jobId);
  await Promise.all(
    processing.map((t) =>
      t.type === "INDEX_BUILD" ? syncIndexBuildTask(t.id) : syncTaskFromRuleEngine(t.id),
    ),
  );

  const refreshed = await prisma.task.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json(refreshed.map(prismaTaskToExtractionTask));
}
