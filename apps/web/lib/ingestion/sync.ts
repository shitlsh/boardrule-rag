import { prisma } from "@/lib/prisma";
import { deleteRawUploadsForGame, writeGameExports } from "@/lib/storage";
import { getBuildIndexJob, getExtractJob } from "./client";
import type { ExtractJobStatus } from "./types";

const TERMINAL_TASK = new Set(["COMPLETED", "FAILED"]);

function mapEngineToTaskStatus(s: ExtractJobStatus): string {
  switch (s) {
    case "pending":
      return "PENDING";
    case "processing":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

function mapEngineToGameExtractionStatus(s: ExtractJobStatus): string {
  switch (s) {
    case "pending":
      return "PENDING";
    case "processing":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/** Progress JSON for extract poll; optional `warnings` mirrors rule-engine `errors` (partial failures). */
function progressFromExtractPoll(
  status: ExtractJobStatus,
  pollError: string | null,
  engineWarnings?: string[] | null,
): string {
  const warnings = (engineWarnings ?? []).filter((s) => s && s.trim());
  const detail =
    status === "failed" && pollError
      ? pollError
      : status === "completed"
        ? warnings.length > 0
          ? `合并与导出完成（${warnings.length} 条步骤警告）`
          : "合并与导出完成"
        : status === "processing"
          ? "规则抽取进行中"
          : "排队或等待规则引擎";
  const payload: { stage: ExtractJobStatus; detail: string; warnings?: string[] } = {
    stage: status,
    detail,
  };
  if (warnings.length > 0) {
    payload.warnings = warnings;
  }
  return JSON.stringify(payload);
}

function progressFromIndexEngine(status: ExtractJobStatus, pollError: string | null): string {
  const detail =
    status === "failed" && pollError
      ? pollError
      : status === "completed"
        ? "向量索引已就绪"
        : status === "processing"
          ? "正在建立向量索引（嵌入、BM25、可选 rerank）"
          : "排队或等待规则引擎";
  return JSON.stringify({ stage: status, detail });
}

/**
 * When the rule engine surfaces KeyError(uuid), the message can look like a bare UUID.
 * Make Task rows self-explanatory without requiring log access for the first clue.
 */
function augmentIndexEngineError(error: string | null, jobId: string): string | null {
  if (error == null || error === "") return error;
  const core = error.trim().replace(/^['"]+|['"]+$/g, "");
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(core);
  if (!isUuid) return error;
  return (
    `${error} — 说明：该片段多来自 Python KeyError（缺失的配置键或字典访问）。` +
    `请查看规则引擎日志中的完整栈。若使用多 worker 部署 Uvicorn，建索引任务只在创建它的进程内存中，` +
    `轮询打到其他 worker 会失败；请改为单 worker 或固定路由。engine_job_id=${jobId}`
  );
}

/**
 * Polls the rule engine for this task’s job and updates `Task` / `Game` plus on-disk exports when done.
 */
export async function syncTaskFromRuleEngine(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { game: true },
  });
  if (!task) {
    return null;
  }
  if (!task.jobId) {
    return task;
  }
  if (TERMINAL_TASK.has(task.status)) {
    return task;
  }

  let poll;
  try {
    poll = await getExtractJob(task.gameId, task.jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: msg,
        progressJson: JSON.stringify({ stage: "sync_error", detail: msg }),
      },
    });
    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        extractionStatus: "FAILED",
        extractionJobId: task.jobId,
      },
    });
    return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
  }

  const taskStatus = mapEngineToTaskStatus(poll.status);
  const gameExtractionStatus = mapEngineToGameExtractionStatus(poll.status);
  const engineWarnings =
    poll.status === "completed" ? (poll.errors ?? []).filter((s) => s && s.trim()) : [];
  const progressJson = progressFromExtractPoll(
    poll.status,
    poll.error,
    engineWarnings.length > 0 ? engineWarnings : null,
  );

  if (poll.status === "completed" && !poll.merged_markdown) {
    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        extractionStatus: "FAILED",
        extractionJobId: task.jobId,
        lastCheckpointId: poll.last_checkpoint_id,
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: "规则引擎返回完成但缺少合并正文",
        progressJson: JSON.stringify({ stage: "completed_empty", detail: "missing merged_markdown" }),
      },
    });
    return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
  }

  if (poll.status === "completed" && poll.merged_markdown) {
    const paths = await writeGameExports(task.gameId, {
      mergedMarkdown: poll.merged_markdown,
      quickStart: poll.quick_start,
      suggestedQuestions: poll.suggested_questions ?? [],
    });

    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        version: { increment: 1 },
        rulesMarkdownPath: paths.rulesMarkdownPath,
        quickStartGuidePath: paths.quickStartGuidePath,
        startQuestionsPath: paths.startQuestionsPath,
        extractionStatus: "COMPLETED",
        extractionJobId: task.jobId,
        lastCheckpointId: poll.last_checkpoint_id,
      },
    });

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        errorMsg: null,
        progressJson,
      },
    });

    await deleteRawUploadsForGame(task.gameId).catch(() => undefined);
  } else if (poll.status === "failed") {
    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        extractionStatus: "FAILED",
        extractionJobId: task.jobId,
        lastCheckpointId: poll.last_checkpoint_id,
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: poll.error ?? "Extraction failed",
        progressJson,
      },
    });
  } else {
    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        extractionStatus: gameExtractionStatus,
        extractionJobId: task.jobId,
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: taskStatus,
        errorMsg: poll.error,
        progressJson,
      },
    });
  }

  return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
}

/**
 * Polls `GET /build-index/jobs/{job_id}` and updates `Task` / `Game.indexId` when completed.
 */
export async function syncIndexBuildTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { game: true },
  });
  if (!task) {
    return null;
  }
  if (task.type !== "INDEX_BUILD") {
    return task;
  }
  if (!task.jobId) {
    return task;
  }
  if (TERMINAL_TASK.has(task.status)) {
    return task;
  }

  let poll;
  try {
    poll = await getBuildIndexJob(task.jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: msg,
        progressJson: JSON.stringify({ stage: "sync_error", detail: msg }),
      },
    });
    return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
  }

  const taskStatus = mapEngineToTaskStatus(poll.status);
  const indexErrDetail = augmentIndexEngineError(poll.error, poll.job_id);
  const progressJson = progressFromIndexEngine(poll.status, indexErrDetail);

  if (poll.status === "completed" && !poll.manifest) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: "规则引擎返回完成但缺少 manifest",
        progressJson: JSON.stringify({
          stage: "completed_empty",
          detail: "missing manifest",
        }),
      },
    });
    return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
  }

  if (poll.status === "completed" && poll.manifest) {
    const rawGid = poll.manifest.game_id;
    const indexId = typeof rawGid === "string" && rawGid.trim() ? rawGid.trim() : task.gameId;

    await prisma.game.update({
      where: { id: task.gameId },
      data: {
        indexId,
        vectorStoreId: indexId,
      },
    });

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        errorMsg: null,
        progressJson,
      },
    });
  } else if (poll.status === "failed") {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMsg: indexErrDetail ?? "建索引失败",
        progressJson,
      },
    });
  } else {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: taskStatus,
        errorMsg: poll.status === "processing" || poll.status === "pending" ? null : indexErrDetail,
        progressJson,
      },
    });
  }

  return prisma.task.findUnique({ where: { id: taskId }, include: { game: true } });
}
