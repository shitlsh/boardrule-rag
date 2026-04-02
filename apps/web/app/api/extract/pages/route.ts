import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { saveUploadedRules } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Saves the upload under storage/ and asks the rule engine to rasterize pages (POST /extract/pages).
 * Returns page thumbnails URLs (prefixed with RULE_ENGINE_URL when relative).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const gameId = form.get("gameId");
  const file = form.get("file");
  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  await saveUploadedRules(gameId, file.name, buf);

  const base = getRuleEngineBaseUrl();
  const engineForm = new FormData();
  engineForm.append("game_id", gameId);
  engineForm.append("file", new Blob([buf], { type: file.type || "application/pdf" }), file.name || "rules.pdf");

  const res = await fetch(`${base}/extract/pages`, { method: "POST", body: engineForm });
  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: text || `Prepare failed: ${res.status}` }, { status: res.status });
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

  return NextResponse.json({ ...data, pages });
}
