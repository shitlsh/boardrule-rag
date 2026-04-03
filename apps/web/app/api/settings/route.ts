import { NextResponse } from "next/server";

import { getAppSettings, updateAppSettings, type AppSettingsPatch } from "@/lib/app-settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json(settings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取设置失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "Expected object body" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const patch: AppSettingsPatch = {};

  const num = (k: keyof AppSettingsPatch) => {
    const v = o[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`${String(k)} 必须是数字`);
    }
    patch[k] = v;
  };

  try {
    num("maxImageBytes");
    num("maxPdfBytes");
    num("maxMultiImageFiles");
    num("maxPdfPages");
    num("maxGstoneImageUrls");
    num("pageRasterDpi");
    num("pageRasterMaxSide");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "参数无效";
    return NextResponse.json({ message: msg }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ message: "无有效字段" }, { status: 400 });
  }

  try {
    const settings = await updateAppSettings(patch);
    return NextResponse.json(settings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
