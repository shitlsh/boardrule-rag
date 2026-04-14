"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GeminiModelPicker } from "@/components/gemini-model-picker";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import { type ChatProfileConfigParsed, chatProfileConfigSchema } from "@/lib/ai-runtime-profile-schema";

type ProfileRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "EXTRACTION" | "CHAT";
  configJson: string;
};

const emptyChatConfig = (): ChatProfileConfigParsed => ({
  chat: { credentialId: "", model: "" },
});

function parseChat(raw: string): ChatProfileConfigParsed {
  return chatProfileConfigSchema.parse(JSON.parse(raw || "{}"));
}

export function ModelsChatTemplates() {
  const [gateway, setGateway] = useState<AiGatewayPublic | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeChatProfileId, setActiveChatProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [chatCfg, setChatCfg] = useState<ChatProfileConfigParsed>(emptyChatConfig);
  const [saving, setSaving] = useState(false);
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  const profileList = profiles.filter((p) => p.kind === "CHAT");
  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const loadAll = useCallback(async () => {
    const [gRes, pRes] = await Promise.all([
      fetch("/api/ai-gateway"),
      fetch("/api/ai-runtime-profiles"),
    ]);
    if (!gRes.ok) throw new Error("无法加载 AI 网关");
    if (!pRes.ok) throw new Error("无法加载模版列表");
    const g = (await gRes.json()) as AiGatewayPublic;
    const pack = (await pRes.json()) as {
      profiles: ProfileRow[];
      activeChatProfileId: string | null;
    };
    setGateway(g);
    setProfiles(pack.profiles);
    setActiveChatProfileId(pack.activeChatProfileId ?? null);
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        await loadAll();
      } catch {
        if (!c) toast.error("加载失败");
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [loadAll]);

  useEffect(() => {
    if (selectedId && !profileList.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [profiles, selectedId, profileList]);

  useEffect(() => {
    if (!selected || selected.kind !== "CHAT") return;
    setEditName(selected.name);
    setEditDescription(selected.description ?? "");
    try {
      setChatCfg(parseChat(selected.configJson));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "配置解析失败");
    }
  }, [selected]);

  const fetchModels = useCallback(async (credentialId: string) => {
    if (!credentialId) return;
    const k = `${credentialId}:chat`;
    setLoadingModels((m) => ({ ...m, [k]: true }));
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot: "chat" }),
      });
      const json = (await res.json()) as { models?: GeminiModelOption[]; message?: string };
      if (!res.ok) throw new Error(json.message || "拉取模型失败");
      setModelLists((prev) => ({ ...prev, [k]: json.models ?? [] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setLoadingModels((m) => ({ ...m, [k]: false }));
    }
  }, []);

  useEffect(() => {
    if (!gateway || !selected || selected.kind !== "CHAT") return;
    const cid = chatCfg.chat?.credentialId?.trim();
    if (cid) void fetchModels(cid);
  }, [gateway, selected, chatCfg.chat?.credentialId, fetchModels]);

  const createProfile = async () => {
    try {
      if (!gateway) {
        toast.error("无法加载 AI 网关");
        return;
      }
      const cred = gateway.credentials.find((c) => c.enabled) ?? gateway.credentials[0] ?? null;
      const credentialId = cred?.id || "";
      if (!credentialId) {
        toast.error("请先在「凭证管理」中添加至少一个 API 凭证");
        return;
      }
      let model = "";
      const mRes = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot: "chat" }),
      });
      const mJson = (await mRes.json()) as { models?: { name: string }[]; message?: string };
      if (!mRes.ok) throw new Error(mJson.message || "拉取聊天模型失败");
      model = mJson.models?.[0]?.name?.trim() ?? "";
      if (!model) {
        toast.error("未找到可用聊天模型，请检查凭证");
        return;
      }
      const configJson: ChatProfileConfigParsed = {
        chat: {
          credentialId,
          model,
          temperature: gateway.chatOptions.temperature ?? 0.2,
          maxTokens: gateway.chatOptions.maxTokens ?? 16384,
        },
      };
      const res = await fetch("/api/ai-runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "新聊天模版",
          kind: "CHAT",
          configJson,
        }),
      });
      const j = (await res.json()) as ProfileRow & { message?: string };
      if (!res.ok) throw new Error(j.message || "创建失败");
      toast.success("已创建");
      await loadAll();
      setSelectedId(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const saveSelected = async () => {
    if (!selected || selected.kind !== "CHAT") return;
    setSaving(true);
    try {
      chatProfileConfigSchema.parse(chatCfg);
      const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          configJson: chatCfg,
        }),
      });
      const j = (await res.json()) as ProfileRow & { message?: string };
      if (!res.ok) throw new Error(j.message || "保存失败");
      toast.success("已保存");
      await loadAll();
      setSelectedId(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!confirm(`删除模版「${selected.name}」？`)) return;
    const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, { method: "DELETE" });
    const j = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(j.message || "删除失败");
      return;
    }
    toast.success("已删除");
    setSelectedId(null);
    await loadAll();
  };

  const setActiveChat = async (id: string) => {
    const res = await fetch("/api/ai-runtime-profiles/active-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeChatProfileId: id }),
    });
    const j = (await res.json()) as { activeChatProfileId?: string | null; message?: string };
    if (!res.ok) {
      toast.error(j.message || "更新失败");
      return;
    }
    setActiveChatProfileId(j.activeChatProfileId ?? null);
    toast.success("已切换全局聊天模版");
  };

  const creds = gateway?.credentials.filter((c) => c.enabled) ?? [];
  const cid = chatCfg.chat?.credentialId ?? "";
  const model = chatCfg.chat?.model ?? "";
  const k = `${cid}:chat`;
  const models = modelLists[k] ?? [];

  if (loading || !gateway) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        仅配置对话模型与温度/长度；检索与分块请在「索引配置」页设置全局 RAG。凭证见「
        <a href="/models/credentials" className="text-primary underline underline-offset-2">
          凭证管理
        </a>
        」。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全局：当前聊天生效模版</CardTitle>
          <CardDescription>
            影响站内 RAG 对话与引擎请求头；必须选择一套 CHAT 模版（不再使用网关内全局 Chat 槽）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label className="mb-2 block text-sm">聊天模版</Label>
            {profileList.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                暂无聊天模版，请先新建或从左侧列表创建后再选择全局生效。
              </p>
            ) : (
              <Select
                value={activeChatProfileId ?? profileList[0]!.id}
                onValueChange={(v) => void setActiveChat(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择模版" />
                </SelectTrigger>
                <SelectContent>
                  {profileList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <CardTitle className="text-base">聊天模版</CardTitle>
            <Button type="button" variant="outline" size="sm" className="w-full gap-1" onClick={() => void createProfile()}>
              <Plus className="h-4 w-4" />
              新建模版
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {profileList.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无模版</p>
            ) : (
              profileList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={
                    selectedId === p.id
                      ? "bg-primary/10 text-primary w-full cursor-pointer rounded-md px-2 py-2 text-left text-sm transition-colors"
                      : "hover:bg-muted w-full cursor-pointer rounded-md px-2 py-2 text-left text-sm transition-colors"
                  }
                >
                  {p.name}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div>
          {!selected || selected.kind !== "CHAT" ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-sm">
                请选择左侧模版或新建
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selected.name}</CardTitle>
                <CardDescription>
                  对话使用 Chat 槽中的模型；温度与长度仅作用于本模版。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FieldGroup>
                  <Field>
                    <FieldLabel>名称</FieldLabel>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>说明</FieldLabel>
                    <Textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  </Field>
                </FieldGroup>

                <div className="border-border space-y-3 rounded-lg border p-4">
                  <div className="font-medium">Chat 槽位</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>凭证</FieldLabel>
                      <Select
                        value={cid || ""}
                        onValueChange={(v) => {
                          setChatCfg((c) => ({
                            ...c,
                            chat: {
                              ...c.chat,
                              credentialId: v,
                              model: c.chat.credentialId === v ? c.chat.model : "",
                              temperature: c.chat.temperature ?? gateway.chatOptions.temperature,
                              maxTokens: c.chat.maxTokens ?? gateway.chatOptions.maxTokens,
                            },
                          }));
                          void fetchModels(v);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择凭证" />
                        </SelectTrigger>
                        <SelectContent>
                          {creds.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.alias} ({c.vendor})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>模型</FieldLabel>
                      <GeminiModelPicker
                        slot="chat"
                        vendor={cid ? (gateway.credentials.find((c) => c.id === cid)?.vendor ?? "gemini") : "gemini"}
                        models={models}
                        value={model}
                        onChange={(v) =>
                          setChatCfg((c) => ({
                            ...c,
                            chat: { ...c.chat, model: v },
                          }))
                        }
                        loading={Boolean(loadingModels[k])}
                        disabled={!cid}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Temperature</FieldLabel>
                      <Input
                        type="number"
                        step={0.1}
                        value={chatCfg.chat.temperature ?? ""}
                        onChange={(e) =>
                          setChatCfg((c) => ({
                            ...c,
                            chat: {
                              ...c.chat,
                              temperature: Number(e.target.value),
                              maxTokens: c.chat.maxTokens ?? gateway.chatOptions.maxTokens,
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>单次回复上限（max tokens）</FieldLabel>
                      <FieldDescription>
                        限制的是<strong>模型单次生成的总输出长度</strong>（含助手最终回复），不是仅用户输入字数。
                        RAG 场景下系统提示、检索到的规则片段与用户问题都会占用上下文，若回答常被截断请适当调高（例如 16384–32768）。
                      </FieldDescription>
                      <Input
                        type="number"
                        min={1}
                        value={chatCfg.chat.maxTokens ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setChatCfg((c) => {
                            const { maxTokens: _drop, ...chatRest } = c.chat;
                            if (raw.trim() === "") {
                              return { ...c, chat: chatRest };
                            }
                            const n = Math.trunc(Number(raw));
                            if (!Number.isFinite(n) || n < 1) {
                              return c;
                            }
                            return {
                              ...c,
                              chat: {
                                ...c.chat,
                                maxTokens: n,
                                temperature: c.chat.temperature ?? gateway.chatOptions.temperature,
                              },
                            };
                          });
                        }}
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void saveSelected()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void deleteSelected()}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
