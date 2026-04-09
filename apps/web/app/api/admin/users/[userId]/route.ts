import { NextResponse } from "next/server";

import { assertAdminSession, getStaffSession } from "@/lib/request-auth";
import { validateNewPassword } from "@/lib/password-policy";
import { setStaffUserDisabled, setStaffUserPassword } from "@/lib/staff-users";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  const { userId } = await params;
  let body: { disabled?: boolean; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const hasDisabled = typeof body.disabled === "boolean";
  const rawNew = body.newPassword;
  const hasNewPassword = typeof rawNew === "string" && rawNew.length > 0;

  if (!hasDisabled && !hasNewPassword) {
    return NextResponse.json({ error: "请提供 disabled 或 newPassword" }, { status: 400 });
  }

  const session = await getStaffSession();

  if (hasDisabled) {
    if (session?.user.id === userId && body.disabled) {
      return NextResponse.json({ error: "不能禁用当前登录账号" }, { status: 400 });
    }
    const ok = await setStaffUserDisabled(userId, body.disabled!);
    if (!ok) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
  }

  if (hasNewPassword) {
    const policyErr = validateNewPassword(rawNew!);
    if (policyErr) {
      return NextResponse.json({ error: policyErr }, { status: 400 });
    }
    const ok = await setStaffUserPassword(userId, rawNew!);
    if (!ok) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}
