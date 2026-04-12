import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import {
  chatProfileConfigSchema,
  extractionProfileConfigSchema,
} from "@/lib/ai-runtime-profile-schema";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { id } = await params;
  const row = await prisma.aiRuntimeProfile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ message: "未找到" }, { status: 404 });
  }
  return NextResponse.json(row);
}

type PatchBody = {
  name?: string;
  description?: string | null;
  configJson?: unknown;
};

export async function PATCH(req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { id } = await params;
  const prev = await prisma.aiRuntimeProfile.findUnique({ where: { id } });
  if (!prev) {
    return NextResponse.json({ message: "未找到" }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const data: {
    name?: string;
    description?: string | null;
    configJson?: string;
  } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ message: "名称不能为空" }, { status: 400 });
    }
    data.name = name;
  }

  if (body.description !== undefined) {
    data.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }

  if (body.configJson !== undefined) {
    try {
      if (prev.kind === "EXTRACTION") {
        extractionProfileConfigSchema.parse(body.configJson);
      } else {
        chatProfileConfigSchema.parse(body.configJson);
      }
      data.configJson = JSON.stringify(body.configJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "配置校验失败";
      return NextResponse.json({ message: msg }, { status: 400 });
    }
  }

  const row = await prisma.aiRuntimeProfile.update({
    where: { id },
    data,
  });

  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { id } = await params;

  const settings = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeChatProfileId: true },
  });
  if (settings?.activeChatProfileId === id) {
    return NextResponse.json(
      { message: "该模版正作为全局聊天生效模版，请先在 AI 运行时页切换后再删除" },
      { status: 409 },
    );
  }

  try {
    await prisma.aiRuntimeProfile.delete({ where: { id } });
  } catch {
    return NextResponse.json({ message: "删除失败（可能仍被引用）" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
