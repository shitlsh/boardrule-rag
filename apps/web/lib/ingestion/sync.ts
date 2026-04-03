import { prisma } from "@/lib/prisma";
import { writeGameExports } from "@/lib/storage";
import { getExtractJob } from "./client";
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

function progressFromEngine(status: ExtractJobStatus, pollError: string | null): string {
  const detail =
    status === "failed" && pollError
      ? pollError
      : status === "completed"
        ? "合并与导出完成"
        : status === "processing"
          ? "规则抽取进行中"
          : "排队或等待规则引擎";
  return JSON.stringify({ stage: status, detail });
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
    poll = await getExtractJob(task.jobId);
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
  const progressJson = progressFromEngine(poll.status, poll.error);

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
