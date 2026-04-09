import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { auth } from "@/auth";
import { validateNewPassword } from "@/lib/password-policy";
import { getStaffPasswordHash, setPasswordAndClearMustChange } from "@/lib/staff-users";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const current = body.currentPassword?.toString() ?? "";
  const next = body.newPassword?.toString() ?? "";
  if (!current || !next) {
    return NextResponse.json({ error: "请填写当前密码与新密码" }, { status: 400 });
  }

  const policyErr = validateNewPassword(next);
  if (policyErr) {
    return NextResponse.json({ error: policyErr }, { status: 400 });
  }
  if (next === current) {
    return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
  }

  const hash = await getStaffPasswordHash(uid);
  if (!hash) {
    return NextResponse.json({ error: "无法校验密码" }, { status: 500 });
  }
  const ok = await bcrypt.compare(current, hash);
  if (!ok) {
    return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
  }

  const updated = await setPasswordAndClearMustChange(uid, next);
  if (!updated) {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
