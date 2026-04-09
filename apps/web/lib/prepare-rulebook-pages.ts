import { downloadRuleImagesFromUrls, fetchGstoneRuleImageUrls } from "@/lib/gstone";
import type { AppSettingsRecord } from "@/lib/app-settings";
import { getAppSettings } from "@/lib/app-settings";
import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { ruleEngineBearerAuth } from "@/lib/rule-engine-headers";
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

/** Appends limits and raster options expected by `POST /extract/pages`. */
export function appendRuleEngineFormSettings(
  form: FormData,
  s: AppSettingsRecord,
  opts?: { maxMultiImageFiles?: number },
): void {
  const multiCap = opts?.maxMultiImageFiles ?? s.maxMultiImageFiles;
  form.append("page_raster_dpi", String(s.pageRasterDpi));
  form.append("page_raster_max_side", String(s.pageRasterMaxSide));
  form.append("max_pages", String(s.maxPdfPages));
  form.append("max_multi_image_files", String(multiCap));
  form.append("max_pdf_bytes", String(s.maxPdfBytes));
  form.append("max_image_bytes", String(s.maxImageBytes));
}

function parseEngineError(text: string): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail) && j.detail[0] && typeof (j.detail[0] as { msg?: string }).msg === "string") {
      return String((j.detail[0] as { msg: string }).msg);
    }
  } catch {
    /* use raw */
  }
  return text;
}

async function enginePost(
  form: FormData,
  engineOpts?: { maxMultiImageFiles?: number },
): Promise<PreparedPagesResult> {
  const base = getRuleEngineBaseUrl();
  const settings = await getAppSettings();
  appendRuleEngineFormSettings(form, settings, engineOpts);

  const res = await fetch(`${base}/extract/pages`, {
    method: "POST",
    headers: ruleEngineBearerAuth(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseEngineError(text) || `Prepare failed: ${res.status}`);
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
  const settings = await getAppSettings();
  const name = (params.file.name || "").toLowerCase();
  const isPdf = params.file.type === "application/pdf" || name.endsWith(".pdf");
  if (isPdf && params.buffer.length > settings.maxPdfBytes) {
    throw new Error(`PDF 超过单文件上限 ${formatBytes(settings.maxPdfBytes)}`);
  }
  if (!isPdf && params.buffer.length > settings.maxImageBytes) {
    throw new Error(`图片超过单文件上限 ${formatBytes(settings.maxImageBytes)}`);
  }

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

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
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
  /** 集石等场景可高于「多图上传」张数上限，与 `maxGstoneImageUrls` 对齐。 */
  engineMultiFileLimit?: number;
}): Promise<PreparedPagesResult> {
  const settings = await getAppSettings();
  const multiCap = params.engineMultiFileLimit ?? settings.maxMultiImageFiles;
  if (params.images.length === 0) {
    throw new Error("至少需要一张图片");
  }
  if (params.images.length > multiCap) {
    throw new Error(`一次最多 ${multiCap} 张图片，当前 ${params.images.length} 张`);
  }
  for (const img of params.images) {
    if (img.buffer.length > settings.maxImageBytes) {
      throw new Error(`图片 ${img.name} 超过单张上限 ${formatBytes(settings.maxImageBytes)}`);
    }
  }

  const engineForm = new FormData();
  engineForm.append("game_id", params.gameId);
  for (const img of params.images) {
    const blob = new Blob([new Uint8Array(img.buffer)], {
      type: img.contentType ?? "image/png",
    });
    engineForm.append("files", blob, img.name);
  }
  return enginePost(engineForm, { maxMultiImageFiles: multiCap });
}

/** Download images from Storage keys (raw bucket) and send as files. */
export async function prepareRulebookPagesFromStorageImageKeys(params: {
  gameId: string;
  keys: string[];
}): Promise<PreparedPagesResult> {
  const settings = await getAppSettings();
  if (params.keys.length > settings.maxMultiImageFiles) {
    throw new Error(`一次最多 ${settings.maxMultiImageFiles} 张图片，当前 ${params.keys.length} 张`);
  }
  const images: { name: string; buffer: Buffer; contentType?: string }[] = [];
  for (const key of params.keys) {
    const buf = await downloadFromRawBucket(key.replace(/^\/+/, ""));
    if (buf.length > settings.maxImageBytes) {
      throw new Error(`图片 ${key} 超过单张上限 ${formatBytes(settings.maxImageBytes)}`);
    }
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
  const settings = await getAppSettings();
  const urls = await fetchGstoneRuleImageUrls(params.sourceUrl);
  if (urls.length > settings.maxGstoneImageUrls) {
    throw new Error(
      `集石页面解析出 ${urls.length} 张图，超过上限 ${settings.maxGstoneImageUrls} 张（可在系统设置中调整）`,
    );
  }
  const excluded = new Set(
    params.excludedIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < urls.length),
  );
  const filtered = urls.filter((_, i) => !excluded.has(i));
  if (filtered.length === 0) {
    throw new Error("请至少保留一页规则图片");
  }
  if (filtered.length > settings.maxPdfPages) {
    throw new Error(
      `保留 ${filtered.length} 页，超过每本规则书最大页数 ${settings.maxPdfPages}（剔除部分页后再试）`,
    );
  }
  const downloaded = await downloadRuleImagesFromUrls(filtered, params.sourceUrl, {
    maxBytesPerImage: settings.maxImageBytes,
  });
  const images = downloaded.map((d) => ({
    name: d.name + (d.name.endsWith(".png") ? "" : ".png"),
    buffer: d.buffer,
    contentType: "image/png" as const,
  }));
  return prepareRulebookPagesFromImageBuffers({
    gameId: params.gameId,
    images,
    engineMultiFileLimit: settings.maxGstoneImageUrls,
  });
}
