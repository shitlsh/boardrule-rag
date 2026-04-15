"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ImageIcon, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelTagFilterChips } from "@/components/model-tag-filter-chips";
import { QwenEndpointPicker } from "@/components/qwen-endpoint-picker";
import type { AiCredentialPublic, AiGatewayPublic, AiVendor, BedrockAuthMode } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import {
  filterModelsByTagIds,
  listAvailableTagIds,
  type ModelTagFilterOptions,
} from "@/lib/model-option-filters";
import {
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";

const CREDENTIAL_SLOT_TAG_OPTS: ModelTagFilterOptions = { showVisionFilter: true };

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

const VENDOR_LABEL: Record<AiVendor, string> = {
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  qwen: "阿里云百炼（Qwen）",
  bedrock: "Amazon Bedrock",
  claude: "Anthropic Claude",
};

/** Short label for the closed select trigger (avoids overflow in narrow layouts). */
const VENDOR_TRIGGER_LABEL: Record<AiVendor, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  qwen: "Qwen",
  bedrock: "Bedrock",
  claude: "Claude",
};

export function ModelCredentialsPanel({ data, onUpdated }: Props) {
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [vendor, setVendor] = useState<AiVendor>("gemini");
  const [qwenBase, setQwenBase] = useState(DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
  const [bedrockRegion, setBedrockRegion] = useState("us-east-1");
  const [bedrockAuthMode, setBedrockAuthMode] = useState<BedrockAuthMode>("api_key");
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState("");
  const [bedrockSecretAccessKey, setBedrockSecretAccessKey] = useState("");
  const [bedrockSessionToken, setBedrockSessionToken] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingEnabledId, setTogglingEnabledId] = useState<string | null>(null);

  const prevVendorRef = useRef<AiVendor>(vendor);
  useEffect(() => {
    if (vendor === "qwen" && prevVendorRef.current !== "qwen") {
      setQwenBase(DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
    }
    if (vendor === "bedrock" && prevVendorRef.current !== "bedrock") {
      setBedrockRegion("us-east-1");
      setBedrockAuthMode("api_key");
      setBedrockAccessKeyId("");
      setBedrockSecretAccessKey("");
      setBedrockSessionToken("");
    }
    prevVendorRef.current = vendor;
  }, [vendor]);

  const add = async () => {
    const a = alias.trim();
    const k = apiKey.trim();
    if (!a) {
      toast.error("请填写别名");
      return;
    }
    if (vendor !== "bedrock" || bedrockAuthMode === "api_key") {
      if (!k) {
        toast.error("请填写 API Key");
        return;
      }
    }
    if (vendor === "bedrock") {
      if (!bedrockRegion.trim()) {
        toast.error("请填写 AWS 区域");
        return;
      }
      if (bedrockAuthMode === "iam") {
        if (!bedrockAccessKeyId.trim() || !bedrockSecretAccessKey.trim()) {
          toast.error("IAM 模式请填写 Access Key ID 与 Secret Access Key");
          return;
        }
      }
    } else if (!k) {
      toast.error("请填写 API Key");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/ai-gateway/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          vendor,
          alias: a,
          apiKey: k,
          ...(vendor === "qwen"
            ? { dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(qwenBase) }
            : {}),
          ...(vendor === "bedrock"
            ? {
                bedrockRegion: bedrockRegion.trim(),
                bedrockAuthMode,
                ...(bedrockAuthMode === "iam"
                  ? {
                      bedrockAccessKeyId: bedrockAccessKeyId.trim(),
                      bedrockSecretAccessKey: bedrockSecretAccessKey.trim(),
                      ...(bedrockSessionToken.trim()
                        ? { bedrockSessionToken: bedrockSessionToken.trim() }
                        : {}),
                    }
                  : {}),
              }
            : {}),
        }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "添加失败");
      }
      onUpdated(json);
      setAlias("");
      setApiKey("");
      setBedrockAccessKeyId("");
      setBedrockSecretAccessKey("");
      setBedrockSessionToken("");
      setAddDialogOpen(false);
      toast.success("凭证已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const setCredentialEnabled = async (c: AiCredentialPublic, enabled: boolean) => {
    if (!enabled) {
      if (
        !confirm(
          "停用后，引用该凭证的 Flash / Pro / Embed / Chat 槽位将被清空。可在启用后重新绑定。确定停用吗？",
        )
      ) {
        return;
      }
    }
    setTogglingEnabledId(c.id);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(c.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "保存失败");
      }
      onUpdated(json);
      toast.success(enabled ? "凭证已启用" : "凭证已停用");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setTogglingEnabledId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除此凭证？引用它的槽位将被清空。")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "删除失败");
      }
      onUpdated(json);
      toast.success("已删除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="text-lg">API 凭证</CardTitle>
            <CardDescription>
              选择供应商并填写密钥。别名全局唯一（不区分大小写）。凭证可在下方槽位中复用；与具体模型 ID 分开配置，可随时增删。
            </CardDescription>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" className="shrink-0 self-stretch sm:self-start">
                <Plus className="h-4 w-4" />
                <span className="ml-2">添加凭证</span>
              </Button>
            </DialogTrigger>
            <DialogContent
              showCloseButton
              className="flex max-h-[min(90dvh,720px)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
            >
              <DialogHeader className="shrink-0 space-y-2 border-b border-border px-6 py-4 text-left">
                <DialogTitle>添加 API 凭证</DialogTitle>
                <DialogDescription>
                  选择供应商并填写密钥。Bedrock 请选择区域与认证方式；IAM 模式下 Session Token 仅用于临时凭证。
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 max-h-[min(55dvh,26rem)] flex-1 overflow-y-auto overflow-x-hidden px-6 [scrollbar-gutter:stable]">
                <div className="space-y-4 py-4">
                  <Field className="min-w-0">
                    <FieldLabel>供应商</FieldLabel>
                    <Select value={vendor} onValueChange={(v) => setVendor(v as AiVendor)}>
                      <SelectTrigger
                        className="w-full min-w-0"
                        title={`${VENDOR_TRIGGER_LABEL[vendor]} — ${VENDOR_LABEL[vendor]}`}
                      >
                        <SelectValue>{VENDOR_TRIGGER_LABEL[vendor]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-w-[min(100vw-2rem,22rem)]">
                        <SelectItem
                          value="gemini"
                          textValue="Gemini Google Gemini AI Studio Vertex"
                          className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                        >
                          <span className="flex flex-col gap-1 text-left leading-snug">
                            <span className="font-medium">Gemini</span>
                            <span className="text-muted-foreground text-xs">
                              Google AI Studio / Vertex 等渠道的密钥
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem
                          value="openrouter"
                          textValue="OpenRouter"
                          className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                        >
                          <span className="flex flex-col gap-1 text-left leading-snug">
                            <span className="font-medium">OpenRouter</span>
                            <span className="text-muted-foreground text-xs">
                              openrouter.ai 控制台中的 API Key
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem
                          value="qwen"
                          textValue="Qwen DashScope Bailian Alibaba"
                          className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                        >
                          <span className="flex flex-col gap-1 text-left leading-snug">
                            <span className="font-medium">Qwen（百炼）</span>
                            <span className="text-muted-foreground text-xs">
                              阿里云大模型服务平台百炼 / DashScope 的 API Key（OpenAI 兼容接口）
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem
                          value="bedrock"
                          textValue="Amazon Bedrock AWS"
                          className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                        >
                          <span className="flex flex-col gap-1 text-left leading-snug">
                            <span className="font-medium">Amazon Bedrock</span>
                            <span className="text-muted-foreground text-xs">
                              IAM（AK/SK）或 Bedrock API Key；需与区域一致
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem
                          value="claude"
                          textValue="Anthropic Claude API"
                          className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                        >
                          <span className="flex flex-col gap-1 text-left leading-snug">
                            <span className="font-medium">Anthropic Claude</span>
                            <span className="text-muted-foreground text-xs">
                              Anthropic 官方 API Key（直连 api.anthropic.com）
                            </span>
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {vendor === "qwen" ? (
                    <div className="min-w-0">
                      <QwenEndpointPicker value={qwenBase} onChange={setQwenBase} disabled={adding} />
                    </div>
                  ) : null}
                  {vendor === "bedrock" ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field className="min-w-0">
                        <FieldLabel>区域</FieldLabel>
                        <Input
                          placeholder="us-east-1"
                          value={bedrockRegion}
                          onChange={(e) => setBedrockRegion(e.target.value)}
                          autoComplete="off"
                          className="w-full min-w-0 font-mono text-sm"
                        />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel>认证方式</FieldLabel>
                        <Select
                          value={bedrockAuthMode}
                          onValueChange={(v) => setBedrockAuthMode(v as BedrockAuthMode)}
                        >
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="api_key">Bedrock API Key</SelectItem>
                            <SelectItem value="iam">IAM（AK/SK）</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  ) : null}
                  <Field className="min-w-0">
                    <FieldLabel>别名</FieldLabel>
                    <Input
                      placeholder="例如 prod、personal"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      autoComplete="off"
                      className="w-full min-w-0"
                    />
                  </Field>
                  {vendor === "bedrock" && bedrockAuthMode === "iam" ? (
                    <div className="space-y-4">
                      <Field className="min-w-0">
                        <FieldLabel>Access Key ID</FieldLabel>
                        <Input
                          type="password"
                          placeholder="AKIA…"
                          value={bedrockAccessKeyId}
                          onChange={(e) => setBedrockAccessKeyId(e.target.value)}
                          autoComplete="off"
                          className="w-full min-w-0 font-mono text-sm"
                        />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel>Secret Access Key</FieldLabel>
                        <Input
                          type="password"
                          placeholder="Secret"
                          value={bedrockSecretAccessKey}
                          onChange={(e) => setBedrockSecretAccessKey(e.target.value)}
                          autoComplete="new-password"
                          className="w-full min-w-0 font-mono text-sm"
                        />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel>Session Token（可选）</FieldLabel>
                        <Input
                          type="password"
                          placeholder="临时凭证时填写"
                          value={bedrockSessionToken}
                          onChange={(e) => setBedrockSessionToken(e.target.value)}
                          autoComplete="off"
                          className="w-full min-w-0 font-mono text-sm"
                        />
                      </Field>
                    </div>
                  ) : (
                    <Field className="min-w-0">
                      <FieldLabel>{vendor === "bedrock" ? "Bedrock API Key" : "API Key"}</FieldLabel>
                      <Input
                        type="password"
                        placeholder={
                          vendor === "bedrock"
                            ? "Bedrock 控制台生成的 API Key"
                            : vendor === "openrouter"
                              ? "粘贴 OpenRouter 控制台中的 API Key"
                              : vendor === "qwen"
                                ? "粘贴阿里云百炼（DashScope）API Key"
                                : vendor === "claude"
                                  ? "粘贴 Anthropic 控制台中的 API Key（sk-ant-…）"
                                  : "粘贴 Google AI Studio 或兼容渠道的密钥"
                        }
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        autoComplete="new-password"
                        className="w-full min-w-0"
                      />
                    </Field>
                  )}
                </div>
              </div>
              <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setAddDialogOpen(false)}
                  disabled={adding}
                >
                  取消
                </Button>
                <Button type="button" className="w-full sm:w-auto min-w-[10rem]" onClick={add} disabled={adding}>
                  {adding ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2">保存中…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      <span className="ml-2">添加并保存</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">暂无已保存凭证。请先添加。</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {data.credentials.map((c: AiCredentialPublic) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {c.alias}{" "}
                      <span className="text-muted-foreground font-normal text-xs">
                        （{VENDOR_LABEL[c.vendor]}）
                      </span>
                      {!c.enabled ? (
                        <Badge variant="secondary" className="ml-2 text-[10px] font-normal">
                          已停用
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {c.hasKey ? `密钥已配置 · 尾号 ${c.keyLast4 ?? "****"}` : "密钥无效或解密失败"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">启用</span>
                      <Switch
                        checked={c.enabled}
                        disabled={togglingEnabledId === c.id || deletingId === c.id}
                        onCheckedChange={(v) => void setCredentialEnabled(c, v)}
                        aria-label="启用凭证"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={deletingId === c.id}
                      onClick={() => remove(c.id)}
                    >
                      {deletingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="ml-1">删除</span>
                    </Button>
                  </div>
                </div>
                {c.vendor === "qwen" ? (
                  <SavedQwenEndpointEditor credential={c} onUpdated={onUpdated} />
                ) : null}
                <CredentialSlotModelsCollapsible
                  credential={c}
                  onUpdated={onUpdated}
                  disabled={!c.enabled}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatTokShort(n: number | null | undefined): string | null {
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

type SlotModelVisibilityFilter = "all" | "visible" | "hidden";

function CredentialSlotModelsCollapsible({
  credential,
  onUpdated,
  disabled,
}: {
  credential: AiCredentialPublic;
  onUpdated: (next: AiGatewayPublic) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<GeminiModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [patching, setPatching] = useState<string | "bulk" | null>(null);
  const [filterText, setFilterText] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<SlotModelVisibilityFilter>("all");
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const prevIdRef = useRef(credential.id);

  useEffect(() => {
    if (prevIdRef.current !== credential.id) {
      prevIdRef.current = credential.id;
      setModels(null);
      setOpen(false);
      setFilterText("");
      setVisibilityFilter("all");
      setTagFilterIds([]);
      setSelectedNames([]);
    }
  }, [credential.id]);

  const hiddenSet = useMemo(() => new Set(credential.hiddenModelIds), [credential.hiddenModelIds]);

  const availableTagIds = useMemo(
    () => (models ? listAvailableTagIds(models, CREDENTIAL_SLOT_TAG_OPTS) : []),
    [models],
  );

  const filteredModels = useMemo(() => {
    if (!models) return [];
    let list = models;
    if (visibilityFilter === "visible") list = list.filter((m) => !hiddenSet.has(m.name));
    else if (visibilityFilter === "hidden") list = list.filter((m) => hiddenSet.has(m.name));

    const q = filterText.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter((m) => {
        const hay = `${m.displayName}\n${m.name}\n${m.description ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    list = filterModelsByTagIds(list, tagFilterIds, CREDENTIAL_SLOT_TAG_OPTS);
    return list;
  }, [models, hiddenSet, filterText, visibilityFilter, tagFilterIds]);

  const filteredIds = useMemo(() => filteredModels.map((m) => m.name), [filteredModels]);
  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedSet.has(id));

  const toggleSelectOne = (name: string) => {
    setSelectedNames((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    const f = new Set(filteredIds);
    if (checked) {
      setSelectedNames((prev) => Array.from(new Set([...prev, ...filteredIds])));
    } else {
      setSelectedNames((prev) => prev.filter((id) => !f.has(id)));
    }
  };

  useEffect(() => {
    if (!open || models !== null || disabled) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentialId: credential.id, includeHidden: true }),
        });
        const json = (await res.json()) as { models?: GeminiModelOption[]; message?: string };
        if (!res.ok) throw new Error(json.message || "拉取模型列表失败");
        if (!cancelled) setModels(json.models ?? []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "拉取模型列表失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, models, credential.id, disabled]);

  const patchHidden = async (nextHidden: string[], progress: string | "bulk") => {
    setPatching(progress);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(credential.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenModelIds: nextHidden }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) throw new Error(json.message || "保存失败");
      onUpdated(json);
      if (progress === "bulk") {
        setSelectedNames([]);
        toast.success("已批量更新槽位可见性");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPatching(null);
    }
  };

  const onToggleModel = (name: string, visible: boolean) => {
    const h = new Set(credential.hiddenModelIds);
    if (visible) h.delete(name);
    else h.add(name);
    void patchHidden(Array.from(h), name);
  };

  const bulkSetVisibleInSlot = (visible: boolean) => {
    if (selectedNames.length === 0) return;
    const h = new Set(credential.hiddenModelIds);
    for (const name of selectedNames) {
      if (visible) h.delete(name);
      else h.add(name);
    }
    void patchHidden(Array.from(h), "bulk");
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} disabled={disabled}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2 h-9 text-muted-foreground hover:text-foreground"
          disabled={disabled}
        >
          <span className="text-xs font-normal">槽位可选模型（隐藏后不会出现在下方槽位下拉中）</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {disabled ? (
          <p className="text-muted-foreground text-xs py-2">请先启用该凭证后再管理模型可见性。</p>
        ) : loading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载全量模型列表…
          </div>
        ) : models && models.length === 0 ? (
          <p className="text-muted-foreground text-xs py-2">未获取到模型，请检查密钥或网络。</p>
        ) : models ? (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Input
                placeholder="筛选显示名、模型 ID 或描述（多词需同时命中）"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="max-w-full sm:max-w-md"
                disabled={patching !== null}
              />
              <Select
                value={visibilityFilter}
                onValueChange={(v) => setVisibilityFilter(v as SlotModelVisibilityFilter)}
                disabled={patching !== null}
              >
                <SelectTrigger className="w-full sm:w-[11rem]">
                  <SelectValue placeholder="可见性" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部模型</SelectItem>
                  <SelectItem value="visible">仅槽位可见</SelectItem>
                  <SelectItem value="hidden">仅已隐藏</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {availableTagIds.length > 0 ? (
              <ModelTagFilterChips
                availableIds={availableTagIds}
                selectedIds={tagFilterIds}
                onToggle={(id) =>
                  setTagFilterIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                  )
                }
                onClear={() => setTagFilterIds([])}
                disabled={patching !== null}
                label="标签（与列表徽章一致，多选为且）"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {patching === "bulk" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedNames.length === 0 || patching !== null}
                onClick={() => bulkSetVisibleInSlot(true)}
              >
                所选显示在槽位
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedNames.length === 0 || patching !== null}
                onClick={() => bulkSetVisibleInSlot(false)}
              >
                所选从槽位隐藏
              </Button>
              <span className="text-muted-foreground text-xs">
                已选 {selectedNames.length} 个
                {filteredModels.length !== models.length ? (
                  <span className="text-muted-foreground/80"> · 当前列表 {filteredModels.length} 个</span>
                ) : null}
              </span>
            </div>
            <ScrollArea className="h-[min(22rem,50vh)] rounded-md border border-border">
              <ul className="divide-y divide-border text-sm">
                {filteredModels.length === 0 ? (
                  <li className="px-3 py-8 text-center text-muted-foreground text-sm">没有符合筛选条件的模型</li>
                ) : (
                  <>
                    <li className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                      <Checkbox
                        id={`slot-models-select-all-${credential.id}`}
                        checked={
                          allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false
                        }
                        onCheckedChange={(v) => toggleSelectAllFiltered(v === true)}
                        disabled={patching !== null || filteredIds.length === 0}
                        aria-label="全选当前筛选结果"
                      />
                      <label
                        htmlFor={`slot-models-select-all-${credential.id}`}
                        className="text-xs text-muted-foreground cursor-pointer select-none"
                      >
                        全选当前筛选结果
                      </label>
                    </li>
                    {filteredModels.map((m) => {
                      const visible = !hiddenSet.has(m.name);
                      const ctx = m.inputTokenLimit;
                      const mode = m.modelMode?.trim()
                        ? m.modelMode.trim().toUpperCase().replace(/-/g, "_")
                        : null;
                      const visionOn =
                        m.supportsVision === true || (m.supportsVision !== false && m.visionHint);
                      const rowBusy = patching === m.name;
                      return (
                        <li
                          key={m.name}
                          className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-2 min-w-0 flex-1 sm:items-center">
                            <Checkbox
                              checked={selectedSet.has(m.name)}
                              onCheckedChange={() => toggleSelectOne(m.name)}
                              disabled={patching !== null}
                              className="mt-0.5 sm:mt-0"
                              aria-label={`选择 ${m.displayName}`}
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="font-medium leading-snug truncate">{m.displayName}</p>
                              <p
                                className="text-[11px] text-muted-foreground font-mono truncate"
                                title={m.name}
                              >
                                {m.name}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {mode ? (
                                  <Badge variant="outline" className="text-[10px] font-normal uppercase">
                                    {mode}
                                  </Badge>
                                ) : null}
                                {formatTokShort(ctx) ? (
                                  <Badge variant="secondary" className="text-[10px] font-normal">
                                    {formatTokShort(ctx)} 上下文
                                  </Badge>
                                ) : null}
                                {visionOn ? (
                                  <Badge variant="outline" className="gap-0.5 text-[10px] font-normal">
                                    <ImageIcon className="size-3" />
                                    VISION
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 sm:pl-2 pl-7 sm:pl-2">
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              在槽位中显示
                            </span>
                            <Switch
                              checked={visible}
                              disabled={patching !== null}
                              onCheckedChange={(v) => onToggleModel(m.name, v)}
                              aria-label={`在槽位中显示 ${m.displayName}`}
                            />
                            {rowBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </>
                )}
              </ul>
            </ScrollArea>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SavedQwenEndpointEditor({
  credential,
  onUpdated,
}: {
  credential: AiCredentialPublic;
  onUpdated: (next: AiGatewayPublic) => void;
}) {
  const normalized = normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase);
  const [base, setBase] = useState(normalized);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBase(normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase));
  }, [credential.id, credential.dashscopeCompatibleBase]);

  const dirty = base !== normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(credential.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashscopeCompatibleBase: base }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "保存失败");
      }
      onUpdated(json);
      toast.success("接入点已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3 max-w-xl">
      <QwenEndpointPicker value={base} onChange={setBase} disabled={saving} />
      <Button type="button" size="sm" variant="secondary" disabled={!dirty || saving} onClick={save}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        <span className={saving ? "ml-2" : ""}>保存接入点</span>
      </Button>
    </div>
  );
}
