import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type Body = {
  activeIndexProfileId?: string | null;
};

/** Set the global default INDEX profile (`AppSettings.activeIndexProfileId`). */
export async function PUT(req: Request) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.activeIndexProfileId;
  if (raw === null || raw === undefined || raw === "") {
    return NextResponse.json(
      { message: "必须选择一套索引模版作为全站默认（Embed + 检索参数）" },
      { status: 400 },
    );
  }

  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) {
    return NextResponse.json({ message: "无效 id" }, { status: 400 });
  }

  const p = await prisma.aiRuntimeProfile.findUnique({ where: { id } });
  if (!p || p.kind !== "INDEX") {
    return NextResponse.json({ message: "索引模版不存在或类型不是 INDEX" }, { status: 404 });
  }

  await prisma.appSettings.update({
    where: { id: "default" },
    data: { activeIndexProfileId: id },
  });

  return NextResponse.json({ activeIndexProfileId: id });
}
