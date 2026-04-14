"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/models/extraction", label: "提取模型" },
  { href: "/models/chat", label: "聊天模型" },
  { href: "/models/index", label: "索引模型" },
] as const;

export function ModelsSubNav() {
  const pathname = usePathname();

  return (
    <div className="space-y-6 pt-1">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">模型管理</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-pretty">
            在子页面中分别配置提取（Flash / Pro）、对话（Chat）与索引（Embed）所用模型；API 凭证在「提取模型」页添加。检索与分块等默认见「索引模型」。
          </p>
        </div>
      </div>
      <nav className="border-border flex flex-wrap gap-1 border-b pb-px" aria-label="模型管理子页面">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
