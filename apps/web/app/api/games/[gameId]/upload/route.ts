import { NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-settings";
import { buildPagePreviewJson } from "@/lib/game-dto";
import {
  prepareRulebookPages,
  prepareRulebookPagesFromGstone,
  prepareRulebookPagesFromImageBuffers,
  prepareRulebookPagesFromStorageImageKeys,
  prepareRulebookPagesFromStorageKey,
} from "@/lib/prepare-rulebook-pages";
import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

const allowedPdf = new Set(["application/pdf"]);
const allowedImage = new Set(["image/png", "image/jpeg", "image/webp"]);

function parseExcludedIndices(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0);
  } catch {
    return [];
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const limits = await getAppSettings();

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    return NextResponse.json({ message: "游戏不存在" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    let body: {
      mode?: string;
      storageKey?: string;
      storageKeys?: string[];
      sourceUrl?: string;
      excludedIndices?: number[];
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
    }

    const mode = (body.mode || "pdf").toLowerCase();

    const pageTask = await prisma.task.create({
      data: { gameId, type: "PAGE_JOB", status: "PROCESSING", createdAt: new Date(), updatedAt: new Date() },
    });

    try {
      let data: Awaited<ReturnType<typeof prepareRulebookPages>>;

      if (mode === "pdf") {
        const key = typeof body.storageKey === "string" ? body.storageKey.trim() : "";
        if (!key) {
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "storageKey is required for mode=pdf", updatedAt: new Date() } });
          return NextResponse.json({ message: "storageKey is required for mode=pdf" }, { status: 400 });
        }
        data = await prepareRulebookPagesFromStorageKey({ gameId, storageKey: key });
      } else if (mode === "images") {
        const keys = Array.isArray(body.storageKeys) ? body.storageKeys.filter((k) => typeof k === "string") : [];
        if (keys.length === 0) {
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "storageKeys required for mode=images", updatedAt: new Date() } });
          return NextResponse.json({ message: "storageKeys required for mode=images" }, { status: 400 });
        }
        if (keys.length > limits.maxMultiImageFiles) {
          const msg = `一次最多 ${limits.maxMultiImageFiles} 张图片，当前 ${keys.length} 张`;
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
          return NextResponse.json({ message: msg }, { status: 400 });
        }
        data = await prepareRulebookPagesFromStorageImageKeys({ gameId, keys });
      } else if (mode === "gstone") {
        const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
        if (!sourceUrl) {
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "sourceUrl required for mode=gstone", updatedAt: new Date() } });
          return NextResponse.json({ message: "sourceUrl required for mode=gstone" }, { status: 400 });
        }
        const excluded = Array.isArray(body.excludedIndices) ? body.excludedIndices : [];
        data = await prepareRulebookPagesFromGstone({ gameId, sourceUrl, excludedIndices: excluded });
      } else {
        await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: `Unknown mode: ${mode}`, updatedAt: new Date() } });
        return NextResponse.json({ message: `Unknown mode: ${mode}` }, { status: 400 });
      }

      await prisma.task.update({
        where: { id: pageTask.id },
        data: { status: "COMPLETED", jobId: data.job_id, progressJson: JSON.stringify({ stage: "completed", detail: `分页完成，共 ${data.total_pages} 页` }), updatedAt: new Date() },
      });
      return finalizePagination(gameId, data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "分页失败";
      await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } }).catch(() => undefined);
      return NextResponse.json({ message: msg }, { status: 502 });
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ message: "Invalid form data" }, { status: 400 });
  }

  const mode = String(formData.get("mode") || "pdf").toLowerCase();

  const pageTask = await prisma.task.create({
    data: { gameId, type: "PAGE_JOB", status: "PROCESSING", createdAt: new Date(), updatedAt: new Date() },
  });

  try {
    if (mode === "gstone") {
      const sourceUrl = String(formData.get("sourceUrl") || "").trim();
      if (!sourceUrl) {
        await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "请提供集石 sourceUrl", updatedAt: new Date() } });
        return NextResponse.json({ message: "请提供集石 sourceUrl" }, { status: 400 });
      }
      const excluded = parseExcludedIndices(typeof formData.get("excludedIndices") === "string" ? (formData.get("excludedIndices") as string) : null);
      const data = await prepareRulebookPagesFromGstone({ gameId, sourceUrl, excludedIndices: excluded });
      await prisma.task.update({
        where: { id: pageTask.id },
        data: { status: "COMPLETED", jobId: data.job_id, progressJson: JSON.stringify({ stage: "completed", detail: `分页完成，共 ${data.total_pages} 页` }), updatedAt: new Date() },
      });
      return finalizePagination(gameId, data);
    }

    if (mode === "images") {
      const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) {
        await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "请至少选择一张图片", updatedAt: new Date() } });
        return NextResponse.json({ message: "请至少选择一张图片" }, { status: 400 });
      }
      if (files.length > limits.maxMultiImageFiles) {
        const msg = `一次最多 ${limits.maxMultiImageFiles} 张图片，当前 ${files.length} 张`;
        await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
        return NextResponse.json({ message: msg }, { status: 400 });
      }
      const images: { name: string; buffer: Buffer; contentType?: string }[] = [];
      for (const f of files) {
        const mime = f.type || "application/octet-stream";
        if (!allowedImage.has(mime)) {
          const msg = `不支持的图片类型: ${mime}`;
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
          return NextResponse.json({ message: msg }, { status: 400 });
        }
        if (f.size > limits.maxImageBytes) {
          const msg = `图片 ${f.name || "未命名"} 超过单张上限 ${limits.maxImageBytes} 字节`;
          await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
          return NextResponse.json({ message: msg }, { status: 400 });
        }
        const buf = Buffer.from(await f.arrayBuffer());
        images.push({ name: f.name || `page_${images.length}.png`, buffer: buf, contentType: mime });
      }
      const data = await prepareRulebookPagesFromImageBuffers({ gameId, images });
      await prisma.task.update({
        where: { id: pageTask.id },
        data: { status: "COMPLETED", jobId: data.job_id, progressJson: JSON.stringify({ stage: "completed", detail: `分页完成，共 ${data.total_pages} 页` }), updatedAt: new Date() },
      });
      return finalizePagination(gameId, data);
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "请选择文件", updatedAt: new Date() } });
      return NextResponse.json({ message: "请选择文件" }, { status: 400 });
    }

    const mime = file.type || "application/octet-stream";
    if (!allowedPdf.has(mime) && !allowedImage.has(mime)) {
      await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: "仅支持 PDF 或图片文件", updatedAt: new Date() } });
      return NextResponse.json({ message: "仅支持 PDF 或图片文件" }, { status: 400 });
    }

    const name = (file.name || "").toLowerCase();
    const treatAsPdf = allowedPdf.has(mime) || name.endsWith(".pdf");
    if (treatAsPdf && file.size > limits.maxPdfBytes) {
      const msg = `PDF 超过单文件上限 ${limits.maxPdfBytes} 字节`;
      await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
      return NextResponse.json({ message: msg }, { status: 400 });
    }
    if (!treatAsPdf && file.size > limits.maxImageBytes) {
      const msg = `图片超过单文件上限 ${limits.maxImageBytes} 字节`;
      await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } });
      return NextResponse.json({ message: msg }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const data = await prepareRulebookPages({ gameId, file, buffer: buf });
    await prisma.task.update({
      where: { id: pageTask.id },
      data: { status: "COMPLETED", jobId: data.job_id, progressJson: JSON.stringify({ stage: "completed", detail: `分页完成，共 ${data.total_pages} 页` }), updatedAt: new Date() },
    });
    return finalizePagination(gameId, data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "上传失败";
    await prisma.task.update({ where: { id: pageTask.id }, data: { status: "FAILED", errorMsg: msg, updatedAt: new Date() } }).catch(() => undefined);
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}

async function finalizePagination(
  gameId: string,
  data: Awaited<ReturnType<typeof prepareRulebookPages>>,
) {
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
}
