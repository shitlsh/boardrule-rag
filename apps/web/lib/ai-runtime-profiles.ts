import { prisma } from "@/lib/prisma";

import {
  parseChatProfileConfigJson,
  parseExtractionProfileConfigJson,
  parseIndexProfileConfigJson,
  type ChatProfileConfigParsed,
  type ExtractionProfileConfigParsed,
  type IndexProfileConfigParsed,
} from "@/lib/ai-runtime-profile-schema";

export async function getActiveChatProfileConfig(): Promise<ChatProfileConfigParsed | null> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeChatProfileId: true },
  });
  const id = row?.activeChatProfileId?.trim();
  if (!id) return null;
  const p = await prisma.aiRuntimeProfile.findUnique({ where: { id } });
  if (!p || p.kind !== "CHAT") return null;
  try {
    return parseChatProfileConfigJson(p.configJson);
  } catch {
    return null;
  }
}

export async function getExtractionProfileConfigById(
  id: string,
): Promise<ExtractionProfileConfigParsed | null> {
  const p = await prisma.aiRuntimeProfile.findUnique({ where: { id: id.trim() } });
  if (!p || p.kind !== "EXTRACTION") return null;
  try {
    return parseExtractionProfileConfigJson(p.configJson);
  } catch {
    return null;
  }
}

/** Latest updated EXTRACTION profile — used to derive coarse flash/pro for chat/index headers when global V2 slots are gone. */
export async function getFirstExtractionProfileConfig(): Promise<ExtractionProfileConfigParsed | null> {
  const rows = await prisma.aiRuntimeProfile.findMany({
    where: { kind: "EXTRACTION" },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  const p = rows[0];
  if (!p) return null;
  try {
    return parseExtractionProfileConfigJson(p.configJson);
  } catch {
    return null;
  }
}

export async function listAiRuntimeProfiles() {
  return prisma.aiRuntimeProfile.findMany({
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getAppActiveChatProfileId(): Promise<string | null> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeChatProfileId: true },
  });
  return row?.activeChatProfileId?.trim() ?? null;
}

export async function setAppActiveChatProfileId(id: string | null): Promise<void> {
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { activeChatProfileId: id },
  });
}

/**
 * When unset or pointing at a deleted/non-CHAT row, assign the latest CHAT profile if any exist.
 */
export async function ensureDefaultActiveChatProfileId(): Promise<void> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeChatProfileId: true },
  });
  const current = row?.activeChatProfileId?.trim();
  if (current) {
    const exists = await prisma.aiRuntimeProfile.findUnique({
      where: { id: current },
      select: { id: true, kind: true },
    });
    if (exists?.kind === "CHAT") return;
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { activeChatProfileId: null },
    });
  }
  const first = await prisma.aiRuntimeProfile.findFirst({
    where: { kind: "CHAT" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!first) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { activeChatProfileId: first.id },
  });
}

export async function getIndexProfileConfigById(id: string): Promise<IndexProfileConfigParsed | null> {
  const p = await prisma.aiRuntimeProfile.findUnique({ where: { id: id.trim() } });
  if (!p || p.kind !== "INDEX") return null;
  try {
    return parseIndexProfileConfigJson(p.configJson);
  } catch {
    return null;
  }
}

export async function getActiveIndexProfileConfig(): Promise<IndexProfileConfigParsed | null> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeIndexProfileId: true },
  });
  const id = row?.activeIndexProfileId?.trim();
  if (!id) return null;
  return getIndexProfileConfigById(id);
}

/**
 * `game.indexProfileId` wins; otherwise site default (`activeIndexProfileId`).
 */
export async function resolveIndexProfileConfigForEngine(
  gameId: string | null | undefined,
): Promise<IndexProfileConfigParsed | null> {
  const gid = gameId?.trim();
  if (gid) {
    const g = await prisma.game.findUnique({
      where: { id: gid },
      select: { indexProfileId: true },
    });
    if (g?.indexProfileId?.trim()) {
      const cfg = await getIndexProfileConfigById(g.indexProfileId);
      if (cfg) return cfg;
    }
  }
  return getActiveIndexProfileConfig();
}

/**
 * When unset or pointing at a deleted/non-INDEX row, assign the latest INDEX profile if any exist.
 */
export async function ensureDefaultActiveIndexProfileId(): Promise<void> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { activeIndexProfileId: true },
  });
  const current = row?.activeIndexProfileId?.trim();
  if (current) {
    const exists = await prisma.aiRuntimeProfile.findUnique({
      where: { id: current },
      select: { id: true, kind: true },
    });
    if (exists?.kind === "INDEX") return;
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { activeIndexProfileId: null },
    });
  }
  const first = await prisma.aiRuntimeProfile.findFirst({
    where: { kind: "INDEX" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!first) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { activeIndexProfileId: first.id },
  });
}
