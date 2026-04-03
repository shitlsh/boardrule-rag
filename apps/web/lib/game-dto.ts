import type { Game as PrismaGame, Task as PrismaTask } from "../generated/prisma/client";

import { parseProgressJson } from "@/lib/progress";
import { readStorageText } from "@/lib/storage";
import type { ExtractionStatus, ExtractionTask, Game, PageThumbnail, TaskStatus } from "@/lib/types";

export function mapGameExtractionStatus(raw: string | null): ExtractionStatus {
  const u = (raw || "PENDING").toUpperCase();
  switch (u) {
    case "PENDING":
      return "pending";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

function mapTaskStatus(raw: string): TaskStatus {
  const u = raw.toUpperCase();
  switch (u) {
    case "PENDING":
      return "pending";
    case "PROCESSING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

function parseSuggestedQuestions(raw: string | null): string[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return undefined;
  }
}

export async function readRulesMarkdownFromDisk(game: PrismaGame): Promise<string | undefined> {
  return readStorageText(game.rulesMarkdownPath);
}

export function pagePreviewToThumbnails(json: string | null): PageThumbnail[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => {
        if (!p || typeof p !== "object") return null;
        const o = p as Record<string, unknown>;
        const pageNumber = typeof o.pageNumber === "number" ? o.pageNumber : Number(o.page);
        const url = typeof o.url === "string" ? o.url : "";
        if (!Number.isFinite(pageNumber) || !url) return null;
        const label = typeof o.label === "string" ? o.label : `P${pageNumber}`;
        return { pageNumber, url, label };
      })
      .filter((x): x is PageThumbnail => x !== null);
  } catch {
    return [];
  }
}

export function buildPagePreviewJson(pages: { page: number; url: string }[]): string {
  const thumbs: PageThumbnail[] = pages.map((p) => ({
    pageNumber: p.page,
    url: p.url,
    label: `P${p.page}`,
  }));
  return JSON.stringify(thumbs);
}

export function prismaGameToDto(
  game: PrismaGame,
  extras?: { rulesMarkdown?: string; quickStart?: string; suggestedQuestions?: string[] },
): Game {
  const isIndexed = Boolean(game.indexId || game.vectorStoreId);
  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    coverUrl: game.coverUrl ?? undefined,
    extractionStatus: mapGameExtractionStatus(game.extractionStatus),
    isIndexed,
    indexId: game.indexId ?? undefined,
    vectorStoreId: game.vectorStoreId ?? undefined,
    paginationJobId: game.pageRasterJobId ?? undefined,
    extractionJobId: game.extractionJobId ?? undefined,
    lastCheckpointId: game.lastCheckpointId ?? undefined,
    rulesMarkdown: extras?.rulesMarkdown,
    quickStart: extras?.quickStart,
    suggestedQuestions: extras?.suggestedQuestions,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}

export async function prismaGameToDetailDto(game: PrismaGame): Promise<Game> {
  const [md, quickRaw, questionsRaw] = await Promise.all([
    readRulesMarkdownFromDisk(game),
    readStorageText(game.quickStartGuidePath),
    readStorageText(game.startQuestionsPath),
  ]);
  const suggestedQuestions = questionsRaw ? parseSuggestedQuestions(questionsRaw) : undefined;
  return prismaGameToDto(game, {
    rulesMarkdown: md,
    quickStart: quickRaw ?? undefined,
    suggestedQuestions,
  });
}

export function prismaTaskToExtractionTask(t: PrismaTask): ExtractionTask {
  const p = parseProgressJson(t.progressJson);
  const label = t.type === "EXTRACTION" ? "规则提取" : t.type;
  return {
    id: t.id,
    type: label,
    status: mapTaskStatus(t.status),
    progress: p?.detail,
    error: t.errorMsg ?? undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
