"use client";

import { useCallback, useEffect, useState } from "react";

import { ModelRagOptionsPanel } from "@/components/model-rag-options-panel";
import { ModelSlotsPanel } from "@/components/model-slots-panel";
import { Spinner } from "@/components/ui/spinner";
import { MODEL_SLOTS_INDEX } from "@/lib/model-slot-groups";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";

export default function ModelsIndexPage() {
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
    <div className="space-y-8">
      <p className="text-muted-foreground text-sm">
        嵌入（Embed）用于向量与建索引；下方 RAG 选项为全局默认（可被「AI 运行时」聊天模版覆盖）。凭证在「
        <a href="/models/extraction" className="text-primary underline underline-offset-2">
          提取模型
        </a>
        」页管理。
      </p>
      <ModelSlotsPanel data={data} onUpdated={onUpdated} allowedSlots={MODEL_SLOTS_INDEX} />
      <ModelRagOptionsPanel data={data} onUpdated={onUpdated} />
    </div>
  );
}
