import fs from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

const DEFAULT_RAW_BUCKET = "rulebook-raw";
const DEFAULT_EXPORTS_BUCKET = "game-exports";

export function rawBucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET_RAW || DEFAULT_RAW_BUCKET).trim();
}

function exportsBucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET_EXPORTS || DEFAULT_EXPORTS_BUCKET).trim();
}

function bucketForKey(relativePath: string): string {
  const k = relativePath.replace(/\\/g, "/");
  if (k.includes("/exports/")) {
    return exportsBucketName();
  }
  if (k.includes("/uploads/")) {
    return rawBucketName();
  }
  return rawBucketName();
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
export function isSupabaseStorageConfigured(): boolean {
  return getSupabaseAdmin() !== null;
}

/**
 * Short-lived HTTPS URL so the rule engine can `GET` an object (e.g. `POST /extract/pages` with `file_url`).
 */
export async function createSignedReadUrl(
  relativePath: string,
  expiresInSeconds = 3600,
): Promise<string | undefined> {
  const client = getSupabaseAdmin();
  if (!client) return undefined;
  const key = normalizeKey(relativePath);
  const bucket = bucketForKey(key);
  const { data, error } = await client.storage.from(bucket).createSignedUrl(key, expiresInSeconds);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

/** Presigned upload URL for browser PUT (raw uploads only). */
export async function createSignedUploadUrl(
  relativePath: string,
): Promise<{ signedUrl: string; path: string; token: string } | undefined> {
  const client = getSupabaseAdmin();
  if (!client) return undefined;
  const key = normalizeKey(relativePath);
  const bucket = rawBucketName();
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(key);
  if (error || !data) return undefined;
  return {
    signedUrl: data.signedUrl,
    path: key,
    token: data.token,
  };
}

/** Download object from raw bucket by key (server-side). */
export async function downloadFromRawBucket(objectKey: string): Promise<Buffer> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured");
  const key = normalizeKey(objectKey);
  const { data, error } = await client.storage.from(rawBucketName()).download(key);
  if (error || !data) throw new Error(error?.message ?? "download failed");
  return Buffer.from(await data.arrayBuffer());
}

/** Delete all objects under `games/{gameId}/uploads/` in the raw bucket. */
export async function deleteRawUploadsForGame(gameId: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (client) {
    const folder = `games/${gameId}/uploads`;
    const { data: list, error: listErr } = await client.storage.from(rawBucketName()).list(folder, {
      limit: 1000,
    });
    if (!listErr && list?.length) {
      const paths = list.map((f) => `${folder}/${f.name}`);
      await client.storage.from(rawBucketName()).remove(paths);
    }
    return;
  }
  const uploadsDir = path.join(STORAGE_ROOT, "games", gameId, "uploads");
  try {
    await fs.rm(uploadsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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
    const bucket = bucketForKey(key);
    const { data, error } = await client.storage.from(bucket).download(key);
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
    const bucket = bucketForKey(key);
    const { error } = await client.storage.from(bucket).upload(key, body, {
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
  const mime = safe.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
  await writeStorageBytes(relativePath, data, { contentType: mime });
  const key = normalizeKey(relativePath);
  const absolutePath = getSupabaseAdmin()
    ? `${rawBucketName()}/${key}`
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
