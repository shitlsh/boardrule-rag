import { NextResponse } from "next/server";

import { signMiniappJwt } from "@/lib/miniapp-jwt";

export const runtime = "nodejs";

/**
 * POST /api/h5-auth
 *
 * Issues a stable anonymous user id and miniapp JWT for H5 / browser clients
 * (no WeChat jscode2session). Same token shape as /api/wx-login for BFF APIs.
 *
 * Response: { userId: string, accessToken: string, expiresIn: number }
 */
export async function POST() {
  try {
    const userId = `h5_${crypto.randomUUID()}`;
    const expiresIn = 7 * 24 * 60 * 60;
    const accessToken = await signMiniappJwt(userId, expiresIn);
    return NextResponse.json({ userId, accessToken, expiresIn });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "h5-auth failed";
    const status = /MINIAPP_JWT_SECRET/.test(msg) ? 503 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
