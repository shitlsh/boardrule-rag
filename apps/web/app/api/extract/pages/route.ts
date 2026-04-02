import { NextResponse } from "next/server";

import { prepareRulebookPages } from "@/lib/prepare-rulebook-pages";

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

  try {
    const data = await prepareRulebookPages({ gameId, file, buffer: buf });
    return NextResponse.json({ ...data, pages: data.pages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
