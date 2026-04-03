import { prisma } from "@/lib/prisma";

export type AppSettingsRecord = {
  maxImageBytes: number;
  maxPdfBytes: number;
  maxMultiImageFiles: number;
  maxPdfPages: number;
  maxGstoneImageUrls: number;
  pageRasterDpi: number;
  pageRasterMaxSide: number;
};

const DEFAULTS: AppSettingsRecord = {
  maxImageBytes: 10 * 1024 * 1024,
  maxPdfBytes: 50 * 1024 * 1024,
  maxMultiImageFiles: 60,
  maxPdfPages: 80,
  maxGstoneImageUrls: 80,
  pageRasterDpi: 150,
  pageRasterMaxSide: 2048,
};

/**
 * Authoritative ingestion limits (DB singleton, created on first read).
 */
export async function getAppSettings(): Promise<AppSettingsRecord> {
  let row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!row) {
    row = await prisma.appSettings.create({
      data: { id: "default", ...DEFAULTS },
    });
  }
  return {
    maxImageBytes: row.maxImageBytes,
    maxPdfBytes: row.maxPdfBytes,
    maxMultiImageFiles: row.maxMultiImageFiles,
    maxPdfPages: row.maxPdfPages,
    maxGstoneImageUrls: row.maxGstoneImageUrls,
    pageRasterDpi: row.pageRasterDpi,
    pageRasterMaxSide: row.pageRasterMaxSide,
  };
}

export type AppSettingsPatch = Partial<AppSettingsRecord>;

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Validates and persists admin-edited limits. Returns updated record.
 */
export async function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettingsRecord> {
  const cur = await getAppSettings();
  const next: AppSettingsRecord = {
    maxImageBytes:
      patch.maxImageBytes !== undefined
        ? clampInt(patch.maxImageBytes, 1024 * 1024, 200 * 1024 * 1024)
        : cur.maxImageBytes,
    maxPdfBytes:
      patch.maxPdfBytes !== undefined
        ? clampInt(patch.maxPdfBytes, 1024 * 1024, 500 * 1024 * 1024)
        : cur.maxPdfBytes,
    maxMultiImageFiles:
      patch.maxMultiImageFiles !== undefined
        ? clampInt(patch.maxMultiImageFiles, 1, 500)
        : cur.maxMultiImageFiles,
    maxPdfPages:
      patch.maxPdfPages !== undefined ? clampInt(patch.maxPdfPages, 1, 500) : cur.maxPdfPages,
    maxGstoneImageUrls:
      patch.maxGstoneImageUrls !== undefined
        ? clampInt(patch.maxGstoneImageUrls, 1, 500)
        : cur.maxGstoneImageUrls,
    pageRasterDpi:
      patch.pageRasterDpi !== undefined ? clampInt(patch.pageRasterDpi, 72, 600) : cur.pageRasterDpi,
    pageRasterMaxSide:
      patch.pageRasterMaxSide !== undefined
        ? clampInt(patch.pageRasterMaxSide, 256, 8192)
        : cur.pageRasterMaxSide,
  };

  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: { id: "default", ...next },
    update: next,
  });

  return next;
}
