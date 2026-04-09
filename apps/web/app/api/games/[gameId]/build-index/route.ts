import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readStorageText } from "@/lib/storage";
import { startBuildIndex } from "@/lib/ingestion";
import { getEngineAiHeaders } from "@/lib/engine-ai";
import { getAiGatewayStored } from "@/lib/ai-gateway";

export const runtime = "nodejs";
/** Submit-only: engine runs build in background; long work is not bound to this request. */
export const maxDuration = 60;

function messageFromRuleEngineBody(text: string, status: number): string {
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const parts = j.detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "";
      });
      const s = parts.filter(Boolean).join("; ");
      if (s) return s;
    }
  } catch {
    /* not JSON */
  }
  return trimmed || `建索引失败 (${status})`;
}

type RouteParams = { params: Promise<{ gameId: string }> };

function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }
  if (!game.rulesMarkdownPath) {
    return NextResponse.json({ message: "尚未提取规则正文，无法建索引" }, { status: 400 });
  }

  const merged = await readStorageText(game.rulesMarkdownPath);
  if (merged === undefined) {
    return NextResponse.json({ message: "无法读取规则文件" }, { status: 400 });
  }
  if (!merged.trim()) {
    return NextResponse.json({ message: "规则文件为空" }, { status: 400 });
  }

  try {
    await getEngineAiHeaders();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        message: `AI 配置不完整，无法建索引：${msg}。请在「/models」中配置凭证并为 Flash / Pro / Embed / Chat 槽位选择模型后保存。`,
      },
      { status: 400 },
    );
  }

  const task = await prisma.task.create({
    data: {
      gameId,
      status: "PENDING",
      type: "INDEX_BUILD",
      progressJson: JSON.stringify({ stage: "queued", detail: "已提交建索引任务" }),
    },
  });

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object") body = raw as Record<string, unknown>;
  } catch {
    /* empty or invalid body */
  }

  const gw = await getAiGatewayStored();
  const ro = gw.ragOptions ?? {};
  const similarityTopK = asInt(body.similarityTopK) ?? ro.similarityTopK;
  const rerankTopN = asInt(body.rerankTopN) ?? ro.rerankTopN;
  const chunkSize = asInt(body.chunkSize) ?? ro.chunkSize;
  const chunkOverlap = asInt(body.chunkOverlap) ?? ro.chunkOverlap;
  const retrievalMode =
    body.retrievalMode === "vector_only" || body.retrievalMode === "hybrid"
      ? body.retrievalMode
      : ro.retrievalMode;
  const useRerank = typeof body.useRerank === "boolean" ? body.useRerank : ro.useRerank;

  try {
    const start = await startBuildIndex({
      gameId: game.id,
      mergedMarkdown: merged,
      sourceFile: game.slug,
      ...(similarityTopK != null && { similarityTopK }),
      ...(rerankTopN != null && { rerankTopN }),
      ...(chunkSize != null && { chunkSize }),
      ...(chunkOverlap != null && { chunkOverlap }),
      ...(retrievalMode != null && { retrievalMode }),
      ...(useRerank != null && { useRerank }),
    });

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: {
          jobId: start.job_id,
          status: "PROCESSING",
          progressJson: JSON.stringify({
            stage: start.status,
            detail: "规则引擎已接收建索引任务",
            engineJobId: start.job_id,
          }),
        },
      }),
      prisma.game.update({
        where: { id: gameId },
        data: { indexId: null, vectorStoreId: null },
      }),
    ]);

    return NextResponse.json({
      message: "建索引任务已启动",
      taskId: task.id,
      engineJobId: start.job_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        errorMsg: messageFromRuleEngineBody(msg, 502),
        progressJson: JSON.stringify({ stage: "submit_error", detail: msg }),
      },
    });
    return NextResponse.json({ message: messageFromRuleEngineBody(msg, 502) }, { status: 502 });
  }
}
