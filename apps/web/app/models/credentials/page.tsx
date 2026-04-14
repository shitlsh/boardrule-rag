"use client";

import { useCallback, useEffect, useState } from "react";

import { ModelCredentialsPanel } from "@/components/model-credentials-panel";
import { Spinner } from "@/components/ui/spinner";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";

export default function ModelsCredentialsPage() {
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
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        通过「添加凭证」弹窗录入 Gemini、OpenRouter、百炼（Qwen）或 Amazon Bedrock 等密钥后，可在「提取模型」「聊天模型」「索引配置」中选择对应凭证与模型。
      </p>
      <ModelCredentialsPanel data={data} onUpdated={onUpdated} />
    </div>
  );
}
