import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { saveUploadedRules } from "@/lib/storage";
import { startExtraction } from "@/lib/ingestion";

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
  const file = form.get("file");
  const terminologyContext =
    typeof form.get("terminologyContext") === "string"
      ? (form.get("terminologyContext") as string)
      : undefined;

  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  await saveUploadedRules(gameId, file.name, buf);

  const task = await prisma.task.create({
    data: {
      gameId,
      status: "PENDING",
      type: "EXTRACTION",
      progressJson: JSON.stringify({ stage: "queued", detail: "已上传，正在提交规则引擎" }),
    },
  });

  try {
    const engineBlob = new Blob([buf], { type: file.type || "application/pdf" });
    const start = await startExtraction({
      gameId,
      gameName: game.name,
      terminologyContext,
      fileBody: engineBlob,
      filename: file.name || "rules.pdf",
    });

    await prisma.task.update({
      where: { id: task.id },
      data: {
        jobId: start.job_id,
        status: "PROCESSING",
        progressJson: JSON.stringify({
          stage: start.status,
          detail: "规则引擎已接收任务",
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
