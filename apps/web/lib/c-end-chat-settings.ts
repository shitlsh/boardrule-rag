/**
 * C 端（H5 / 小程序 JWT）对话限额：每 IP 与全站总量，存于 AppSettings。
 */
import { prisma } from "@/lib/prisma";

export type CEndChatLimitsPublic = {
  /** 每个 IP 每 UTC 日上限；0 = 不限制 */
  dailyChatLimitPerIp: number;
  /** 全站 C 端每 UTC 日对话总次数上限；0 = 不限制 */
  dailyChatLimitGlobal: number;
};

const DEFAULT_PER_IP = 20;
const DEFAULT_GLOBAL = 1000;

export async function getCEndChatLimitsPublic(): Promise<CEndChatLimitsPublic> {
  const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return {
    dailyChatLimitPerIp: row?.dailyChatLimit ?? DEFAULT_PER_IP,
    dailyChatLimitGlobal: row?.dailyChatLimitGlobal ?? DEFAULT_GLOBAL,
  };
}

export type CEndChatLimitsPatch = {
  dailyChatLimitPerIp?: number;
  dailyChatLimitGlobal?: number;
};

export async function updateCEndChatLimits(patch: CEndChatLimitsPatch): Promise<CEndChatLimitsPublic> {
  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  const data: {
    dailyChatLimit?: number;
    dailyChatLimitGlobal?: number;
  } = {};
  if (patch.dailyChatLimitPerIp !== undefined) {
    data.dailyChatLimit = Math.max(0, Math.trunc(patch.dailyChatLimitPerIp));
  }
  if (patch.dailyChatLimitGlobal !== undefined) {
    data.dailyChatLimitGlobal = Math.max(0, Math.trunc(patch.dailyChatLimitGlobal));
  }

  if (Object.keys(data).length > 0) {
    await prisma.appSettings.update({ where: { id: "default" }, data });
  }

  return getCEndChatLimitsPublic();
}
