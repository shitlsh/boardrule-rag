import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { startExtractionWithPagePlan } from "@/lib/ingestion";
import { parsePageIndices } from "@/lib/page-indices";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "gameId query is required" }, { status: 400 });
  }
  const tasks = await prisma.task.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const gameId = form.get("gameId");
  const pageJobId = form.get("pageJobId");
  const terminologyContext =
    typeof form.get("terminologyContext") === "string"
      ? (form.get("terminologyContext") as string)
      : undefined;

  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }
  if (typeof pageJobId !== "string" || !pageJobId.trim()) {
    return NextResponse.json(
      { error: "pageJobId is required — call POST /api/extract/pages first to rasterize the rulebook" },
      { status: 400 },
    );
  }

  const tocPageIndices = parsePageIndices(form.get("tocPageIndices"));
  const excludePageIndices = parsePageIndices(form.get("excludePageIndices"));

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const task = await prisma.task.create({
    data: {
      gameId,
      status: "PENDING",
      type: "EXTRACTION",
      progressJson: JSON.stringify({ stage: "queued", detail: "已提交规则抽取（视觉管线）" }),
    },
  });

  try {
    const start = await startExtractionWithPagePlan({
      gameId,
      gameName: game.name,
      terminologyContext,
      pageJobId: pageJobId.trim(),
      tocPageIndices,
      excludePageIndices,
    });

    await prisma.task.update({
      where: { id: task.id },
      data: {
        jobId: start.job_id,
        status: "PROCESSING",
        progressJson: JSON.stringify({
          stage: start.status,
          detail: "规则引擎已接收抽取任务",
          extractionJobId: start.job_id,
        }),
      },
    });

    await prisma.game.update({
      where: { id: gameId },
      data: {
        extractionJobId: start.job_id,
        extractionStatus: "PROCESSING",
      },
    });

    const updated = await prisma.task.findUnique({
      where: { id: task.id },
      include: { game: true },
    });

    return NextResponse.json({ task: updated }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        errorMsg: msg,
        progressJson: JSON.stringify({ stage: "submit_error", detail: msg }),
      },
    });
    await prisma.game.update({
      where: { id: gameId },
      data: { extractionStatus: "FAILED" },
    });
    return NextResponse.json({ error: msg, taskId: task.id }, { status: 502 });
  }
}
