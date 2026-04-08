import { NextResponse } from "next/server";

import {
  getWechatConfigPublic,
  updateWechatConfig,
  type WechatConfigPatch,
} from "@/lib/wechat-settings";

export const runtime = "nodejs";

/**
 * GET /api/settings/wechat
 * Returns the public (safe) WeChat config — never exposes raw AppSecret.
 */
export async function GET() {
  try {
    const config = await getWechatConfigPublic();
    return NextResponse.json(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取微信设置失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/wechat
 * Accepts { appId?, appSecret?, dailyChatLimit? }.
 * Validates types, then persists via updateWechatConfig.
 */
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "无效的 JSON 请求体" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "请求体必须是对象" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const patch: WechatConfigPatch = {};

  if (o.appId !== undefined) {
    if (typeof o.appId !== "string") {
      return NextResponse.json({ message: "appId 必须是字符串" }, { status: 400 });
    }
    patch.appId = o.appId;
  }

  if (o.appSecret !== undefined) {
    if (typeof o.appSecret !== "string") {
      return NextResponse.json({ message: "appSecret 必须是字符串" }, { status: 400 });
    }
    patch.appSecret = o.appSecret;
  }

  if (o.dailyChatLimit !== undefined) {
    if (typeof o.dailyChatLimit !== "number" || !Number.isFinite(o.dailyChatLimit)) {
      return NextResponse.json({ message: "dailyChatLimit 必须是数字" }, { status: 400 });
    }
    patch.dailyChatLimit = o.dailyChatLimit;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ message: "无有效字段" }, { status: 400 });
  }

  try {
    const config = await updateWechatConfig(patch);
    return NextResponse.json(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
