import { prisma } from "@/lib/prisma";

import {
  parseChatProfileConfigJson,
  parseExtractionProfileConfigJson,
  type ChatProfileConfigParsed,
  type ExtractionProfileConfigParsed,
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
