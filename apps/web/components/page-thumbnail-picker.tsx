"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PageThumbnail } from "@/lib/types";

export type PagePickRole = "none" | "toc" | "exclude";

interface PageThumbnailPickerProps {
  pages: PageThumbnail[];
  isLoading: boolean;
  roleByPage: Record<number, PagePickRole>;
  onCycleRole: (pageNumber: number) => void;
}

/**
 * Click cycles: none → 目录 → 排除 → none. Used in step 2 for TOC / exclude vs full-page ads.
 */
export function PageThumbnailPicker({
  pages,
  isLoading,
  roleByPage,
  onCycleRole,
}: PageThumbnailPickerProps) {
  if (isLoading) {
    return (
      <div className="flex gap-3 py-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-24 flex-shrink-0 rounded-md" />
        ))}
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">暂无页面，请先在步骤一完成分页</div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        点击缩略图循环：无标记 → <span className="text-primary">目录页</span> →{" "}
        <span className="text-amber-600 dark:text-amber-400">排除页</span>（广告/全图等）→ 无
      </p>
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 py-2">
          {pages.map((page) => {
            const role = roleByPage[page.pageNumber] ?? "none";
            return (
              <button
                key={page.pageNumber}
                type="button"
                onClick={() => onCycleRole(page.pageNumber)}
                className={cn(
                  "group relative w-24 flex-shrink-0 overflow-hidden rounded-md border-2 text-left transition-colors",
                  role === "toc" && "border-primary ring-1 ring-primary/30",
                  role === "exclude" && "border-amber-500 ring-1 ring-amber-400/40",
                  role === "none" && "border-border hover:border-primary/40",
                )}
              >
                <div className="aspect-[3/4] bg-muted">
                  <img
                    src={page.url}
                    alt={`第 ${page.pageNumber} 页`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-background/90 px-1 py-0.5 text-center backdrop-blur-sm">
                  <span className="text-[10px] font-medium leading-tight">
                    {page.label}
                    {role === "toc" ? " · 目录" : role === "exclude" ? " · 排除" : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
