import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type Body = {
  activeChatProfileId?: string | null;
};

/**
 * Set the global active CHAT profile (`AppSettings.activeChatProfileId`).
 * Pass `null` to use only `/models` defaults (no named chat template).
 */
export async function PUT(req: Request) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.activeChatProfileId;
  if (raw === null || raw === undefined || raw === "") {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { activeChatProfileId: null },
    });
    return NextResponse.json({ activeChatProfileId: null });
  }

  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) {
    return NextResponse.json({ message: "无效 id" }, { status: 400 });
  }

  const p = await prisma.aiRuntimeProfile.findUnique({ where: { id } });
  if (!p || p.kind !== "CHAT") {
    return NextResponse.json({ message: "聊天模版不存在或类型不是 CHAT" }, { status: 404 });
  }

  await prisma.appSettings.update({
    where: { id: "default" },
    data: { activeChatProfileId: id },
  });

  return NextResponse.json({ activeChatProfileId: id });
}
