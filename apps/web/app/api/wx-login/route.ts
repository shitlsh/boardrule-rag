import { NextResponse } from "next/server";

import { getWechatCredentials } from "@/lib/wechat-settings";

export const runtime = "nodejs";

/**
 * POST /api/wx-login
 *
 * Exchanges a WeChat miniapp `code` (from `uni.login()`) for a stable `userId`
 * (the WeChat `openid`). The openid is returned to the miniapp and used as the
 * `x-user-id` header on subsequent `/api/chat` requests.
 *
 * Body: { code: string }
 * Response: { userId: string }
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "无效的请求体" }, { status: 400 });
  }

  const code =
    typeof (body as Record<string, unknown>).code === "string"
      ? ((body as Record<string, unknown>).code as string).trim()
      : "";

  if (!code) {
    return NextResponse.json({ message: "code 不能为空" }, { status: 400 });
  }

  const creds = await getWechatCredentials();
  if (!creds) {
    return NextResponse.json(
      { message: "微信小程序尚未配置，请先在系统设置中填写 AppID 和 AppSecret" },
      { status: 503 },
    );
  }

  // Call WeChat jscode2session API
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", creds.appId);
  url.searchParams.set("secret", creds.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  let wxRes: Response;
  try {
    wxRes = await fetch(url.toString());
  } catch {
    return NextResponse.json({ message: "无法连接微信服务器，请稍后重试" }, { status: 502 });
  }

  const wxBody = (await wxRes.json()) as Record<string, unknown>;

  // WeChat returns errcode on failure (errcode 0 or absent = success)
  if (wxBody.errcode && wxBody.errcode !== 0) {
    const msg =
      typeof wxBody.errmsg === "string" ? wxBody.errmsg : String(wxBody.errcode);
    return NextResponse.json(
      { message: `微信登录失败: ${msg}` },
      { status: 400 },
    );
  }

  const openid = typeof wxBody.openid === "string" ? wxBody.openid.trim() : "";
  if (!openid) {
    return NextResponse.json({ message: "微信未返回 openid" }, { status: 502 });
  }

  return NextResponse.json({ userId: openid });
}
