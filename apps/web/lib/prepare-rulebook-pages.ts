import { downloadRuleImagesFromUrls, fetchGstoneRuleImageUrls } from "@/lib/gstone";
import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import {
  createSignedReadUrl,
  downloadFromRawBucket,
  saveUploadedRules,
  isSupabaseStorageConfigured,
} from "@/lib/storage";

export type PreparedPagesResult = {
  job_id: string;
  game_id: string;
  total_pages: number;
  pages: { page: number; url: string }[];
};

async function enginePost(form: FormData): Promise<PreparedPagesResult> {
  const base = getRuleEngineBaseUrl();
  const res = await fetch(`${base}/extract/pages`, { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Prepare failed: ${res.status}`);
  }

  const data = JSON.parse(text) as {
    job_id: string;
    game_id: string;
    total_pages: number;
    pages: { page: number; url: string }[];
  };

  const origin = base.replace(/\/$/, "");
  const pages = data.pages.map((p) => ({
    ...p,
    url: p.url.startsWith("http") ? p.url : `${origin}${p.url.startsWith("/") ? "" : "/"}${p.url}`,
  }));

  return { ...data, pages };
}

/** Single PDF or single image: upload to storage (or pass through) and call extract/pages. */
export async function prepareRulebookPages(params: {
  gameId: string;
  file: File;
  buffer: Buffer;
}): Promise<PreparedPagesResult> {
  const { relativePath } = await saveUploadedRules(params.gameId, params.file.name, params.buffer);

  const engineForm = new FormData();
  engineForm.append("game_id", params.gameId);

  if (isSupabaseStorageConfigured()) {
    const signed = await createSignedReadUrl(relativePath, 3600);
    if (!signed) {
      throw new Error("Could not create signed URL for uploaded rulebook (check Supabase Storage)");
    }
    engineForm.append("file_url", signed);
  } else {
    const bytes = new Uint8Array(params.buffer);
    engineForm.append(
      "file",
      new Blob([bytes], { type: params.file.type || "application/pdf" }),
      params.file.name || "rules.pdf",
    );
  }

  return enginePost(engineForm);
}

/** After client presigned PUT, only `storageKey` is known (same as relative path). */
export async function prepareRulebookPagesFromStorageKey(params: {
  gameId: string;
  storageKey: string;
  /** Original filename for MIME hint when not inferrable */
  fileName?: string;
}): Promise<PreparedPagesResult> {
  const signed = await createSignedReadUrl(params.storageKey, 3600);
  if (!signed) {
    throw new Error("Could not create signed URL for storage object");
  }
  const engineForm = new FormData();
  engineForm.append("game_id", params.gameId);
  engineForm.append("file_url", signed);
  return enginePost(engineForm);
}

/** Multipart `files` to rule_engine (ordered images). */
export async function prepareRulebookPagesFromImageBuffers(params: {
  gameId: string;
  images: { name: string; buffer: Buffer; contentType?: string }[];
}): Promise<PreparedPagesResult> {
  if (params.images.length === 0) {
    throw new Error("至少需要一张图片");
  }
  const engineForm = new FormData();
  engineForm.append("game_id", params.gameId);
  for (const img of params.images) {
    const blob = new Blob([new Uint8Array(img.buffer)], {
      type: img.contentType ?? "image/png",
    });
    engineForm.append("files", blob, img.name);
  }
  return enginePost(engineForm);
}

/** Download images from Storage keys (raw bucket) and send as files. */
export async function prepareRulebookPagesFromStorageImageKeys(params: {
  gameId: string;
  keys: string[];
}): Promise<PreparedPagesResult> {
  const images: { name: string; buffer: Buffer; contentType?: string }[] = [];
  for (const key of params.keys) {
    const buf = await downloadFromRawBucket(key.replace(/^\/+/, ""));
    const base = key.split("/").pop() ?? `page_${images.length}.png`;
    const mime = base.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : base.toLowerCase().match(/\.jpe?g$/i)
        ? "image/jpeg"
        : "image/png";
    images.push({ name: base, buffer: buf, contentType: mime });
  }
  return prepareRulebookPagesFromImageBuffers({ gameId: params.gameId, images });
}

export async function prepareRulebookPagesFromGstone(params: {
  gameId: string;
  sourceUrl: string;
  excludedIndices: number[];
}): Promise<PreparedPagesResult> {
  const urls = await fetchGstoneRuleImageUrls(params.sourceUrl);
  const excluded = new Set(
    params.excludedIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < urls.length),
  );
  const filtered = urls.filter((_, i) => !excluded.has(i));
  if (filtered.length === 0) {
    throw new Error("请至少保留一页规则图片");
  }
  const downloaded = await downloadRuleImagesFromUrls(filtered, params.sourceUrl);
  const images = downloaded.map((d) => ({
    name: d.name + (d.name.endsWith(".png") ? "" : ".png"),
    buffer: d.buffer,
    contentType: "image/png" as const,
  }));
  return prepareRulebookPagesFromImageBuffers({ gameId: params.gameId, images });
}
