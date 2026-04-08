"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { ModelChatOptionsPanel } from "@/components/model-chat-options-panel";
import { ModelCredentialsPanel } from "@/components/model-credentials-panel";
import { ModelSlotsPanel } from "@/components/model-slots-panel";
import { Spinner } from "@/components/ui/spinner";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";

export default function ModelsPage() {
  const [data, setData] = useState<AiGatewayPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/ai-gateway");
    if (!res.ok) {
      throw new Error("读取失败");
    }
    const json = (await res.json()) as AiGatewayPublic;
    setData(json);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) setError("无法加载模型配置");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onUpdated = useCallback((next: AiGatewayPublic) => {
    setData(next);
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-1">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-1 pb-12">
      <div className="flex items-start gap-3 pt-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">模型管理</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-pretty">
            管理 Gemini 凭证与各能力槽位（Flash / Pro / Embed / Chat）。凭证与槽位相互独立；槽位与对话参数在编辑后会自动保存。
          </p>
        </div>
      </div>

      <div className="space-y-8">
        <ModelCredentialsPanel data={data} onUpdated={onUpdated} />
        <ModelSlotsPanel data={data} onUpdated={onUpdated} />
        <ModelChatOptionsPanel data={data} onUpdated={onUpdated} />
      </div>
    </div>
  );
}
