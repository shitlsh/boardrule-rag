import type { Session } from "next-auth";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { verifyMiniappJwt, type MiniappJwtPayload } from "@/lib/miniapp-jwt";

export type StaffSession = Session & {
  user: NonNullable<Session["user"]> & { id: string; role: "admin" | "user" };
};

function authHeader(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

/** NextAuth session for staff (admin UI). */
export async function getStaffSession(): Promise<StaffSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const role = session.user.role;
  if (role !== "admin" && role !== "user") return null;
  return session as StaffSession;
}

const jsonErr = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function assertStaffSession(): Promise<NextResponse | null> {
  const s = await getStaffSession();
  if (!s) return jsonErr(401, "未登录或会话已过期");
  return null;
}

export async function assertAdminSession(): Promise<NextResponse | null> {
  const s = await getStaffSession();
  if (!s) return jsonErr(401, "未登录或会话已过期");
  if (s.user.role !== "admin") return jsonErr(403, "需要管理员权限");
  return null;
}

/** Miniapp Bearer JWT (openid in `sub`). */
export async function getMiniappPayload(request: Request): Promise<MiniappJwtPayload | null> {
  const token = authHeader(request);
  if (!token) return null;
  return verifyMiniappJwt(token);
}

export type StaffOrMiniapp =
  | { kind: "staff"; session: StaffSession }
  | { kind: "miniapp"; miniapp: MiniappJwtPayload };

/**
 * Staff session OR valid miniapp JWT (for shared BFF routes: games list, chat, etc.).
 */
export async function assertStaffOrMiniapp(request: Request): Promise<NextResponse | StaffOrMiniapp> {
  const staff = await getStaffSession();
  if (staff) return { kind: "staff", session: staff };

  const miniapp = await getMiniappPayload(request);
  if (miniapp) return { kind: "miniapp", miniapp };

  return jsonErr(401, "需要登录或有效的小程序令牌");
}
