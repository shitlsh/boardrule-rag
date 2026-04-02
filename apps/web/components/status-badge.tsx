import { Badge } from "@/components/ui/badge";
import { EXTRACTION_STATUS_LABEL, labelForStatus, TASK_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "destructive" | "muted";

function variantForTaskStatus(status: string): Variant {
  switch (status) {
    case "COMPLETED":
      return "secondary";
    case "FAILED":
      return "destructive";
    case "PROCESSING":
      return "default";
    default:
      return "muted";
  }
}

function variantForExtractionStatus(status: string | null | undefined): Variant {
  if (!status) return "outline";
  return variantForTaskStatus(status);
}

export function TaskStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={variantForTaskStatus(status)} className={cn(className)}>
      <span className="sr-only">任务状态：</span>
      {labelForStatus(TASK_STATUS_LABEL, status)}
    </Badge>
  );
}

export function ExtractionStatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  return (
    <Badge variant={variantForExtractionStatus(status)} className={cn(className)}>
      <span className="sr-only">提取状态：</span>
      {labelForStatus(EXTRACTION_STATUS_LABEL, status)}
    </Badge>
  );
}
