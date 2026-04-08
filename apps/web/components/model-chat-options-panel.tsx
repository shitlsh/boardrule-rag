"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

export function ModelChatOptionsPanel({ data, onUpdated }: Props) {
  const [temperature, setTemperature] = useState(data.chatOptions.temperature);
  const [maxTokens, setMaxTokens] = useState(data.chatOptions.maxTokens);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTemperature(data.chatOptions.temperature);
    setMaxTokens(data.chatOptions.maxTokens);
  }, [data.chatOptions.temperature, data.chatOptions.maxTokens]);

  const save = async () => {
    if (
      temperature === data.chatOptions.temperature &&
      maxTokens === data.chatOptions.maxTokens
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/ai-gateway/chat-options", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature, maxTokens }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "保存失败");
      }
      onUpdated(json);
      toast.success("对话参数已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          对话（Chat）参数
          {saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </CardTitle>
        <CardDescription>
          用于 RAG 问答合成。修改后失焦（点击框外）或按 Tab 离开输入框时自动保存。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:max-w-2xl">
          <Field className="flex-1 min-w-0">
            <FieldLabel>Temperature</FieldLabel>
            <Input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              onBlur={() => void save()}
            />
          </Field>
          <Field className="flex-1 min-w-0">
            <FieldLabel>Max tokens</FieldLabel>
            <Input
              type="number"
              min={1}
              max={100000}
              step={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              onBlur={() => void save()}
            />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
