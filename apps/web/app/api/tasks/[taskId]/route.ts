import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { assertStaffSession } from "@/lib/request-auth";
import { syncIndexBuildTask, syncTaskFromRuleEngine } from "@/lib/ingestion";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { taskId } = await params;
  const before = await prisma.task.findUnique({
    where: { id: taskId },
    include: { game: true },
  });
  if (!before) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const task =
    before.type === "INDEX_BUILD"
      ? await syncIndexBuildTask(taskId)
      : await syncTaskFromRuleEngine(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}
