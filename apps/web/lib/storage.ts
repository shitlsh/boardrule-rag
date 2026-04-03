import fs from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

const DEFAULT_BUCKET = "game-assets";

function storageBucket(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True when uploads/exports go to Supabase Storage (S3-compatible API). */
export function useSupabaseStorage(): boolean {
  return getSupabaseAdmin() !== null;
}

/**
 * Short-lived HTTPS URL so the rule engine can `GET` an object (e.g. `POST /extract/pages` with `file_url`).
 * No-op for local disk storage — callers should not use this when `useSupabaseStorage()` is false.
 */
export async function createSignedReadUrl(
  relativePath: string,
  expiresInSeconds = 3600,
): Promise<string | undefined> {
  const client = getSupabaseAdmin();
  if (!client) return undefined;
  const key = normalizeKey(relativePath);
  const { data, error } = await client.storage
    .from(storageBucket())
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

export function gameStorageRelative(gameId: string, ...segments: string[]): string {
  return path.posix.join("games", gameId, ...segments);
}

function normalizeKey(relativePath: string): string {
  return relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
}

/**
 * Read text from Supabase Storage (when configured) or from local `storage/` using the same object key.
 */
export async function readStorageText(relativePath: string | null | undefined): Promise<string | undefined> {
  if (!relativePath?.trim()) return undefined;
  const key = normalizeKey(relativePath);
  const client = getSupabaseAdmin();
  if (client) {
    const { data, error } = await client.storage.from(storageBucket()).download(key);
    if (error || !data) return undefined;
    try {
      return await data.text();
    } catch {
      return undefined;
    }
  }
  const abs = path.join(STORAGE_ROOT, ...key.split("/"));
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return undefined;
  }
}

async function writeStorageBytes(
  relativePath: string,
  body: Buffer,
  opts?: { contentType?: string },
): Promise<void> {
  const key = normalizeKey(relativePath);
  const client = getSupabaseAdmin();
  if (client) {
    const { error } = await client.storage.from(storageBucket()).upload(key, body, {
      upsert: true,
      contentType: opts?.contentType ?? "application/octet-stream",
    });
    if (error) throw new Error(error.message);
    return;
  }
  const abs = path.join(STORAGE_ROOT, ...key.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveUploadedRules(
  gameId: string,
  originalName: string,
  data: Buffer,
): Promise<{ absolutePath: string; relativePath: string }> {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "rules.pdf";
  const relativePath = gameStorageRelative(gameId, "uploads", safe);
  await writeStorageBytes(relativePath, data, { contentType: "application/pdf" });
  const key = normalizeKey(relativePath);
  const absolutePath = getSupabaseAdmin()
    ? `${storageBucket()}/${key}`
    : path.join(STORAGE_ROOT, ...key.split("/"));
  return { absolutePath, relativePath };
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
  const rulesRel = gameStorageRelative(gameId, "exports", "rules.md");
  const quickRel = gameStorageRelative(gameId, "exports", "quickstart.md");
  const questionsRel = gameStorageRelative(gameId, "exports", "start-questions.json");

  await writeStorageBytes(rulesRel, Buffer.from(payload.mergedMarkdown, "utf8"), {
    contentType: "text/markdown; charset=utf-8",
  });
  if (payload.quickStart) {
    await writeStorageBytes(quickRel, Buffer.from(payload.quickStart, "utf8"), {
      contentType: "text/markdown; charset=utf-8",
    });
  }
  await writeStorageBytes(
    questionsRel,
    Buffer.from(JSON.stringify(payload.suggestedQuestions, null, 2), "utf8"),
    { contentType: "application/json; charset=utf-8" },
  );

  return {
    rulesMarkdownPath: rulesRel,
    quickStartGuidePath: payload.quickStart ? quickRel : null,
    startQuestionsPath: questionsRel,
  };
}
