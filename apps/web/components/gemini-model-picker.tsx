"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, ImageIcon, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import type { AiVendor, SlotKey } from "@/lib/ai-gateway-types";
import { cn } from "@/lib/utils";

function formatTokenShort(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

function truncateDesc(s: string, max = 140): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * cmdk 默认 filter 基于 command-score，偏拉丁字母；中英文混合与「包含关键词」更适合用子串匹配。
 * 返回 0 表示隐藏，(0,1] 表示保留（此处匹配即 1）。
 */
const geminiModelFilter = (itemValue: string, search: string, keywords?: string[]) => {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const blob = [itemValue, ...(keywords ?? [])].join("\n").toLowerCase();
  const normalized = blob.replace(/\s+/g, " ");
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 1;
  return parts.every((p) => normalized.includes(p)) ? 1 : 0;
};

type Props = {
  slot: SlotKey;
  /** Credential vendor — affects placeholder and helper copy. */
  vendor?: AiVendor;
  models: GeminiModelOption[];
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  disabled?: boolean;
};

export function GeminiModelPicker({
  slot,
  vendor = "gemini",
  models,
  value,
  onChange,
  loading,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => models.find((m) => m.name === value), [models, value]);
  const showVision = slot !== "embed";
  const orphanSaved = Boolean(value.trim()) && !selected && !loading;

  const triggerLabel = (() => {
    if (loading) return "加载模型列表…";
    if (selected) return selected.displayName;
    if (orphanSaved) return "已保存的模型不在当前列表中";
    if (vendor === "openrouter") return "请选择模型（OpenRouter 为 vendor/model 形式）";
    if (vendor === "qwen") return "请选择模型（百炼为 qwen-* 等 ID）";
    return "请选择模型";
  })();

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-9 w-full justify-between px-3 py-2 font-normal"
            disabled={disabled || loading || models.length === 0}
            aria-expanded={open}
            aria-label="选择模型"
          >
            <span className="truncate text-left text-sm">
              {loading ? (
                <span className="text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  加载模型列表…
                </span>
              ) : (
                <span
                  className={cn(
                    orphanSaved ? "text-destructive font-medium" : "",
                    !value && !orphanSaved ? "text-muted-foreground" : "",
                  )}
                >
                  {triggerLabel}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(100vw-2rem,28rem)] overflow-hidden p-0"
          align="start"
        >
          <Command
            filter={geminiModelFilter}
            className="rounded-md [&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border"
            label="搜索模型"
          >
            <CommandInput
              placeholder="搜索显示名、ID 或描述中的词…"
              className={cn(
                "h-9 rounded-none border-0 py-2",
                "bg-transparent shadow-none",
                "outline-none ring-0 ring-offset-0",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "focus-visible:bg-muted/40",
              )}
            />
            <CommandList>
              <CommandEmpty>{loading ? "加载中…" : "无匹配模型"}</CommandEmpty>
              <CommandGroup heading="模型">
                {models.map((m) => {
                  const ctx = formatTokenShort(m.inputTokenLimit);
                  const out = formatTokenShort(m.outputTokenLimit);
                  const idShort = m.name.replace(/^models\//, "");
                  return (
                    <CommandItem
                      key={m.name}
                      value={m.name}
                      keywords={[
                        m.displayName,
                        m.name,
                        idShort,
                        m.description ?? "",
                      ]}
                      onSelect={() => {
                        onChange(m.name);
                        setOpen(false);
                      }}
                      className="flex items-start gap-2 py-2"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          value === m.name ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium leading-snug">{m.displayName}</span>
                          {ctx ? (
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              {ctx} 上下文
                            </Badge>
                          ) : null}
                          {out ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              输出 {out}
                            </Badge>
                          ) : null}
                          {showVision && m.visionHint ? (
                            <Badge variant="outline" className="gap-0.5 text-[10px] font-normal">
                              <ImageIcon className="size-3" />
                              多模态
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <p className="text-muted-foreground text-[11px] leading-snug">
        {vendor === "openrouter"
          ? "在显示名、模型 ID（如 openai/gpt-4o-mini）、描述中做包含匹配；多词用空格时需同时命中。"
          : vendor === "qwen"
            ? "在显示名、模型 ID（如 qwen-turbo）、描述中做包含匹配；多词用空格时需同时命中。"
            : "在显示名、模型 ID（含或不含 models/ 前缀）、描述中做包含匹配；多词用空格时需同时命中。"}
      </p>

      {orphanSaved ? (
        <p className="text-destructive text-xs leading-relaxed">
          请在列表中重新选择一个模型后再保存
          {vendor === "openrouter"
            ? "（OpenRouter 可能已下线或重命名该模型）"
            : vendor === "qwen"
              ? "（百炼可能已下线或重命名该模型）"
              : "（历史 ID 可能已不可用）"}
          。
        </p>
      ) : null}
      {selected?.description ? (
        <p className="text-muted-foreground text-xs leading-relaxed" title={selected.description}>
          {truncateDesc(selected.description, 220)}
        </p>
      ) : null}
    </div>
  );
}
