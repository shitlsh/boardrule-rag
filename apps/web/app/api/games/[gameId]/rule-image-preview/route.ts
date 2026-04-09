import { NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-settings";
import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import { fetchGstoneRuleImageUrls } from "@/lib/gstone";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }

  const sourceUrl =
    typeof body === "object" && body !== null && "sourceUrl" in body
      ? String((body as { sourceUrl?: unknown }).sourceUrl ?? "").trim()
      : "";

  if (!sourceUrl) {
    return NextResponse.json({ error: "请提供集石页面 URL（sourceUrl）" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: "URL 格式无效" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "仅支持 http 或 https 链接" }, { status: 400 });
  }

  try {
    const limits = await getAppSettings();
    const urls = await fetchGstoneRuleImageUrls(sourceUrl);
    if (urls.length > limits.maxGstoneImageUrls) {
      return NextResponse.json(
        {
          error: `集石页面解析出 ${urls.length} 张图，超过上限 ${limits.maxGstoneImageUrls} 张（可在系统设置中调整）`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ urls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析规则图片失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
