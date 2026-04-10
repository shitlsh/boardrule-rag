"use client";

import { useEffect, useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DASHSCOPE_ENDPOINT_PRESETS,
  normalizeDashscopeCompatibleBase,
  presetIdForBase,
} from "@/lib/dashscope-endpoint";

type Props = {
  /** Current base URL (no trailing slash). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export function QwenEndpointPicker({ value, onChange, disabled }: Props) {
  const n = normalizeDashscopeCompatibleBase(value);
  const inferred = presetIdForBase(n);
  const [customMode, setCustomMode] = useState(inferred === "custom");

  useEffect(() => {
    setCustomMode(presetIdForBase(normalizeDashscopeCompatibleBase(value)) === "custom");
  }, [value]);

  const selectValue = customMode ? "custom" : inferred === "custom" ? "custom" : inferred;

  return (
    <div className="space-y-2">
      <Field>
        <FieldLabel>百炼接入点（OpenAI 兼容）</FieldLabel>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === "custom") {
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            const found = DASHSCOPE_ENDPOINT_PRESETS.find((p) => p.id === v);
            if (found) onChange(found.base);
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择地域" />
          </SelectTrigger>
          <SelectContent>
            {DASHSCOPE_ENDPOINT_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">自定义 URL</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {customMode ? (
        <Field>
          <FieldLabel className="text-xs">自定义 base URL</FieldLabel>
          <Input
            className="font-mono text-xs"
            placeholder="https://…/compatible-mode/v1"
            value={n}
            disabled={disabled}
            onChange={(e) => {
              const t = e.target.value.trim().replace(/\/+$/, "");
              onChange(t);
            }}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            须为 https，路径通常以 <span className="font-mono">/compatible-mode/v1</span> 结尾（无末尾斜杠）。
          </p>
        </Field>
      ) : null}
    </div>
  );
}
