import { NextResponse } from "next/server";

import { buildPagePreviewJson } from "@/lib/game-dto";
import { prepareRulebookPages } from "@/lib/prepare-rulebook-pages";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

const allowedTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function POST(req: Request, { params }: RouteParams) {
  const { gameId } = await params;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ message: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "请选择文件" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!allowedTypes.has(mime)) {
    return NextResponse.json({ message: "仅支持 PDF 或图片文件" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const data = await prepareRulebookPages({ gameId, file, buffer: buf });
    const previewJson = buildPagePreviewJson(data.pages);

    await prisma.game.update({
      where: { id: gameId },
      data: {
        pageRasterJobId: data.job_id,
        pagePreviewJson: previewJson,
      },
    });

    return NextResponse.json({
      message: "上传成功",
      paginationJobId: data.job_id,
      job_id: data.job_id,
      total_pages: data.total_pages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "上传失败";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
