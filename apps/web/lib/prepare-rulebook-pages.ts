import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { createSignedReadUrl, saveUploadedRules, useSupabaseStorage } from "@/lib/storage";

export type PreparedPagesResult = {
  job_id: string;
  game_id: string;
  total_pages: number;
  pages: { page: number; url: string }[];
};

export async function prepareRulebookPages(params: {
  gameId: string;
  file: File;
  buffer: Buffer;
}): Promise<PreparedPagesResult> {
  const { relativePath } = await saveUploadedRules(params.gameId, params.file.name, params.buffer);

  const base = getRuleEngineBaseUrl();
  const engineForm = new FormData();
  engineForm.append("game_id", params.gameId);

  if (useSupabaseStorage()) {
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

  const res = await fetch(`${base}/extract/pages`, { method: "POST", body: engineForm });
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
