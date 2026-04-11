"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { modelTagIdLabel } from "@/lib/model-option-filters";
import { cn } from "@/lib/utils";

type Props = {
  availableIds: string[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
  /** Shown next to the chip row */
  label?: string;
};

export function ModelTagFilterChips({
  availableIds,
  selectedIds,
  onToggle,
  onClear,
  disabled,
  className,
  label = "标签",
}: Props) {
  if (availableIds.length === 0) return null;

  const selectedSet = new Set(selectedIds);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1.5 gap-y-2">
        <span className="text-muted-foreground text-xs shrink-0">{label}</span>
        {availableIds.map((id) => {
          const on = selectedSet.has(id);
          return (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              className="h-7 px-2 text-[11px] font-normal"
              disabled={disabled}
              onClick={() => onToggle(id)}
            >
              {modelTagIdLabel(id)}
            </Button>
          );
        })}
        {selectedIds.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            disabled={disabled}
            onClick={onClear}
          >
            <X className="size-3.5 mr-1" />
            清除标签
          </Button>
        ) : null}
      </div>
    </div>
  );
}
