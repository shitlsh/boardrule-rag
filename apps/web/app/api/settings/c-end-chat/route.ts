import { NextResponse } from "next/server";

import {
  getCEndChatLimitsPublic,
  updateCEndChatLimits,
  type CEndChatLimitsPatch,
} from "@/lib/c-end-chat-settings";
import { assertAdminSession, assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

/**
 * GET /api/settings/c-end-chat
 * C 端（H5 / 小程序）对话限额：每 IP、全站每日总量。
 */
export async function GET() {
  const denied = await assertStaffSession();
  if (denied) return denied;

  try {
    const limits = await getCEndChatLimitsPublic();
    return NextResponse.json(limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/c-end-chat
 * Body: { dailyChatLimitPerIp?: number, dailyChatLimitGlobal?: number }
 */
export async function PATCH(req: Request) {
  const denied = await assertAdminSession();
  if (denied) return denied;

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
  const patch: CEndChatLimitsPatch = {};

  if (o.dailyChatLimitPerIp !== undefined) {
    if (typeof o.dailyChatLimitPerIp !== "number" || !Number.isFinite(o.dailyChatLimitPerIp)) {
      return NextResponse.json({ message: "dailyChatLimitPerIp 必须是数字" }, { status: 400 });
    }
    patch.dailyChatLimitPerIp = o.dailyChatLimitPerIp;
  }

  if (o.dailyChatLimitGlobal !== undefined) {
    if (typeof o.dailyChatLimitGlobal !== "number" || !Number.isFinite(o.dailyChatLimitGlobal)) {
      return NextResponse.json({ message: "dailyChatLimitGlobal 必须是数字" }, { status: 400 });
    }
    patch.dailyChatLimitGlobal = o.dailyChatLimitGlobal;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ message: "无有效字段" }, { status: 400 });
  }

  try {
    const limits = await updateCEndChatLimits(patch);
    return NextResponse.json(limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
