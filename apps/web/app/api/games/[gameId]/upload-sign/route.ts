import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import { createSignedUploadUrl, gameStorageRelative, isSupabaseStorageConfigured } from "@/lib/storage";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "upload.bin";
}

/**
 * Returns a presigned upload URL for the raw bucket so the browser can PUT without sending bytes through Vercel.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  if (!isSupabaseStorageConfigured()) {
    return NextResponse.json(
      { message: "Presigned upload requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" },
      { status: 400 },
    );
  }

  let body: { fileName?: string };
  try {
    body = (await req.json()) as { fileName?: string };
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const fileName = safeFileName(typeof body.fileName === "string" ? body.fileName : "rules.pdf");
  const unique = `${Date.now()}_${fileName}`;
  const relativePath = gameStorageRelative(gameId, "uploads", unique);

  const signed = await createSignedUploadUrl(relativePath);
  if (!signed) {
    return NextResponse.json({ message: "Could not create signed upload URL" }, { status: 500 });
  }

  return NextResponse.json({
    path: signed.path,
    signedUrl: signed.signedUrl,
    token: signed.token,
    relativePath,
  });
}
