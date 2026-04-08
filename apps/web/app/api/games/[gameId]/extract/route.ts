import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { startExtractionWithPagePlan } from "@/lib/ingestion";
import { parsePageIndices } from "@/lib/page-indices";
import { isStalePageJobEngineError } from "@/lib/stale-page-job";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

type Body = {
  tocPages?: string;
  excludePages?: string;
  terminologyContext?: string;
  /** Skip simple-profile gate on the rule engine (force multi-stage routing). */
  forceFullPipeline?: boolean;
};

export async function POST(req: Request, { params }: RouteParams) {
  const { gameId } = await params;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  const pageJobId = game.pageRasterJobId?.trim();
  if (!pageJobId) {
    return NextResponse.json(
      { message: "请先上传规则书并完成分页" },
      { status: 400 },
    );
  }

  const tocPageIndices = parsePageIndices(body.tocPages ?? "");
  const excludePageIndices = parsePageIndices(body.excludePages ?? "");
  const terminologyContext =
    typeof body.terminologyContext === "string" && body.terminologyContext.trim()
      ? body.terminologyContext.trim()
      : undefined;

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
      pageJobId,
      tocPageIndices,
      excludePageIndices,
      forceFullPipeline: body.forceFullPipeline === true,
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

    return NextResponse.json({
      message: "提取任务已启动",
      extractionJobId: start.job_id,
    });
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

    if (isStalePageJobEngineError(msg)) {
      await prisma.game.update({
        where: { id: gameId },
        data: {
          extractionStatus: "FAILED",
          pageRasterJobId: null,
          pagePreviewJson: null,
        },
      });
      return NextResponse.json(
        {
          code: "STALE_PAGE_JOB" as const,
          message:
            "分页会话已失效（常见于规则引擎重启：内存中的分页任务 ID 不再有效）。已清空本游戏的分页缓存，请重新在上方提交「确认并分页」，然后再启动提取。",
        },
        { status: 409 },
      );
    }

    await prisma.game.update({
      where: { id: gameId },
      data: { extractionStatus: "FAILED" },
    });
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
