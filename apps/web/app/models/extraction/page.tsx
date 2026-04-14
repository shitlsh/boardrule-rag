"use client";

import { ModelsExtractionTemplates } from "@/components/models-extraction-templates";

export default function ModelsExtractionPage() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        API 凭证在「
        <a href="/models/credentials" className="text-primary underline underline-offset-2">
          凭证管理
        </a>
        」页维护；此处仅配置提取管线各节点模型与运行时。
      </p>
      <ModelsExtractionTemplates />
    </div>
  );
}
