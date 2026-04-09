import { NextResponse } from "next/server";

import { assertAdminSession } from "@/lib/request-auth";
import { validateNewPassword } from "@/lib/password-policy";
import { createStaffUser, listStaffUsers } from "@/lib/staff-users";

export const runtime = "nodejs";

export async function GET() {
  const denied = await assertAdminSession();
  if (denied) return denied;
  const users = await listStaffUsers();
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  let body: { email?: string; password?: string; name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const email = body.email?.trim();
  const password = body.password?.trim();
  if (!email || !password) {
    return NextResponse.json({ error: "email 与 password 必填" }, { status: 400 });
  }
  const pwErr = validateNewPassword(password);
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 });
  }
  const role = body.role === "admin" ? "admin" : "user";
  try {
    const u = await createStaffUser({
      email,
      password,
      name: body.name?.trim() || null,
      role,
    });
    return NextResponse.json({ id: u.id }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate|23505/i.test(msg)) {
      return NextResponse.json({ error: "该邮箱已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
