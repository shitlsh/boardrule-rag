export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  PROCESSING: "处理中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

export const EXTRACTION_STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  PROCESSING: "处理中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

export function labelForStatus(map: Record<string, string>, status: string | null | undefined): string {
  if (!status) return "—";
  return map[status] ?? status;
}
