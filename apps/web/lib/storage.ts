import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

export function gameStorageRelative(gameId: string, ...segments: string[]): string {
  return path.posix.join("games", gameId, ...segments);
}

function gameAbs(gameId: string, ...segments: string[]): string {
  return path.join(STORAGE_ROOT, "games", gameId, ...segments);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveUploadedRules(
  gameId: string,
  originalName: string,
  data: Buffer,
): Promise<{ absolutePath: string; relativePath: string }> {
  const uploads = gameAbs(gameId, "uploads");
  await ensureDir(uploads);
  const safe = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "rules.pdf";
  const absolutePath = path.join(uploads, safe);
  await fs.writeFile(absolutePath, data);
  return {
    absolutePath,
    relativePath: gameStorageRelative(gameId, "uploads", safe),
  };
}

export type GameExportPayload = {
  mergedMarkdown: string;
  quickStart: string | null;
  suggestedQuestions: string[];
};

export async function writeGameExports(
  gameId: string,
  payload: GameExportPayload,
): Promise<{
  rulesMarkdownPath: string;
  quickStartGuidePath: string | null;
  startQuestionsPath: string;
}> {
  const exportsDir = gameAbs(gameId, "exports");
  await ensureDir(exportsDir);
  const rulesPath = path.join(exportsDir, "rules.md");
  const quickPath = path.join(exportsDir, "quickstart.md");
  const questionsPath = path.join(exportsDir, "start-questions.json");

  await fs.writeFile(rulesPath, payload.mergedMarkdown, "utf8");
  if (payload.quickStart) {
    await fs.writeFile(quickPath, payload.quickStart, "utf8");
  }
  await fs.writeFile(questionsPath, JSON.stringify(payload.suggestedQuestions, null, 2), "utf8");

  return {
    rulesMarkdownPath: gameStorageRelative(gameId, "exports", "rules.md"),
    quickStartGuidePath: payload.quickStart
      ? gameStorageRelative(gameId, "exports", "quickstart.md")
      : null,
    startQuestionsPath: gameStorageRelative(gameId, "exports", "start-questions.json"),
  };
}
