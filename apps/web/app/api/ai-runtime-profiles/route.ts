import { NextResponse } from "next/server";

import { ensureDefaultActiveChatProfileId, ensureDefaultActiveIndexProfileId } from "@/lib/ai-runtime-profiles";
import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import {
  chatProfileConfigSchema,
  extractionProfileConfigSchema,
  indexProfileConfigSchema,
} from "@/lib/ai-runtime-profile-schema";

export const runtime = "nodejs";

export async function GET() {
  const denied = await assertStaffSession();
  if (denied) return denied;

  await ensureDefaultActiveChatProfileId();
  await ensureDefaultActiveIndexProfileId();

  const [profiles, settings] = await Promise.all([
    prisma.aiRuntimeProfile.findMany({
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { activeChatProfileId: true, activeIndexProfileId: true },
    }),
  ]);

  return NextResponse.json({
    profiles,
    activeChatProfileId: settings?.activeChatProfileId ?? null,
    activeIndexProfileId: settings?.activeIndexProfileId ?? null,
  });
}

type PostBody = {
  name?: string;
  description?: string;
  kind?: "EXTRACTION" | "CHAT" | "INDEX";
  configJson?: unknown;
};

export async function POST(req: Request) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ message: "名称不能为空" }, { status: 400 });
  }
  if (body.kind !== "EXTRACTION" && body.kind !== "CHAT" && body.kind !== "INDEX") {
    return NextResponse.json({ message: "kind 须为 EXTRACTION、CHAT 或 INDEX" }, { status: 400 });
  }

  let configStr: string;
  if (body.configJson !== undefined && body.configJson !== null) {
    try {
      if (body.kind === "EXTRACTION") {
        extractionProfileConfigSchema.parse(body.configJson);
      } else if (body.kind === "CHAT") {
        chatProfileConfigSchema.parse(body.configJson);
      } else {
        indexProfileConfigSchema.parse(body.configJson);
      }
      configStr = JSON.stringify(body.configJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "配置校验失败";
      return NextResponse.json({ message: msg }, { status: 400 });
    }
  } else {
    if (body.kind === "EXTRACTION") {
      configStr = JSON.stringify({ slotBindings: {} });
      try {
        extractionProfileConfigSchema.parse(JSON.parse(configStr));
      } catch {
        return NextResponse.json({ message: "默认配置无效" }, { status: 400 });
      }
    } else if (body.kind === "CHAT") {
      return NextResponse.json(
        { message: "CHAT 模版创建时必须提供有效的 configJson（含 chat 槽位）" },
        { status: 400 },
      );
    } else {
      return NextResponse.json(
        { message: "INDEX 模版创建时必须提供有效的 configJson（含 embed 与可选 ragOptions）" },
        { status: 400 },
      );
    }
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const row = await prisma.aiRuntimeProfile.create({
    data: {
      name,
      description,
      kind: body.kind,
      configJson: configStr,
    },
  });

  return NextResponse.json(row);
}
