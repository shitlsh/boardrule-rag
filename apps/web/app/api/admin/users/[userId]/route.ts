import { NextResponse } from "next/server";

import { assertAdminSession, getStaffSession } from "@/lib/request-auth";
import { setStaffUserDisabled } from "@/lib/staff-users";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  const { userId } = await params;
  let body: { disabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "disabled 必须为布尔值" }, { status: 400 });
  }

  const session = await getStaffSession();
  if (session?.user.id === userId && body.disabled) {
    return NextResponse.json({ error: "不能禁用当前登录账号" }, { status: 400 });
  }

  const ok = await setStaffUserDisabled(userId, body.disabled);
  if (!ok) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
