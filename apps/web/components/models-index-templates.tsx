"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { AiGatewayPublic, RagOptionsStored } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import {
  type IndexProfileConfigParsed,
  indexProfileConfigSchema,
} from "@/lib/ai-runtime-profile-schema";
import { INDEX_RAG_DEFAULTS } from "@/lib/rule-engine-defaults";

type ProfileRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "EXTRACTION" | "CHAT" | "INDEX";
  configJson: string;
};

function parseIndex(raw: string): IndexProfileConfigParsed {
  return indexProfileConfigSchema.parse(JSON.parse(raw || "{}"));
}

const emptyIndex = (): IndexProfileConfigParsed => ({
  embed: { credentialId: "", model: "" },
  ragOptions: {},
});

export function ModelsIndexTemplates() {
  const [gateway, setGateway] = useState<AiGatewayPublic | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeIndexProfileId, setActiveIndexProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [idxCfg, setIdxCfg] = useState<IndexProfileConfigParsed>(emptyIndex);
  const [saving, setSaving] = useState(false);
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  const profileList = profiles.filter((p) => p.kind === "INDEX");
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
      activeIndexProfileId: string | null;
    };
    setGateway(g);
    setProfiles(pack.profiles);
    setActiveIndexProfileId(pack.activeIndexProfileId ?? null);
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
    if (!selected || selected.kind !== "INDEX") return;
    setEditName(selected.name);
    setEditDescription(selected.description ?? "");
    try {
      setIdxCfg(parseIndex(selected.configJson));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "配置解析失败");
    }
  }, [selected]);

  const fetchModels = useCallback(async (credentialId: string) => {
    if (!credentialId) return;
    const k = `${credentialId}:embed`;
    setLoadingModels((m) => ({ ...m, [k]: true }));
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot: "embed" }),
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
    if (!gateway || !selected || selected.kind !== "INDEX") return;
    const cid = idxCfg.embed?.credentialId?.trim();
    if (cid) void fetchModels(cid);
  }, [gateway, selected?.id, selected?.kind, idxCfg.embed?.credentialId, fetchModels]);

  const ro = idxCfg.ragOptions ?? {};

  const patchRag = (patch: Partial<RagOptionsStored>) => {
    setIdxCfg((c) => ({
      ...c,
      ragOptions: { ...(c.ragOptions ?? {}), ...patch },
    }));
  };

  /** Clear numeric keys when input is emptied; plain `patchRag({})` does not delete existing keys. */
  const patchRagNumeric = (
    key: "similarityTopK" | "rerankTopN" | "chunkSize" | "chunkOverlap",
    raw: string,
    min: number,
  ) => {
    setIdxCfg((c) => {
      const ro = { ...(c.ragOptions ?? {}) };
      const t = raw.trim();
      if (t === "") {
        delete ro[key];
      } else {
        const n = Math.trunc(Number(t));
        if (!Number.isFinite(n) || n < min) {
          return c;
        }
        ro[key] = n;
      }
      return { ...c, ragOptions: ro };
    });
  };

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
      const mRes = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot: "embed" }),
      });
      const mJson = (await mRes.json()) as { models?: { name: string }[]; message?: string };
      if (!mRes.ok) throw new Error(mJson.message || "拉取嵌入模型失败");
      const model = mJson.models?.[0]?.name?.trim() ?? "";
      if (!model) {
        toast.error("未找到可用嵌入模型");
        return;
      }
      const configJson: IndexProfileConfigParsed = {
        embed: { credentialId, model },
        ragOptions: {
          similarityTopK: 8,
          rerankTopN: 5,
          chunkSize: 1024,
          chunkOverlap: 128,
          retrievalMode: "hybrid",
          useRerank: true,
        },
      };
      const res = await fetch("/api/ai-runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "新索引模版",
          kind: "INDEX",
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
    if (!selected || selected.kind !== "INDEX") return;
    setSaving(true);
    try {
      indexProfileConfigSchema.parse(idxCfg);
      const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          configJson: idxCfg,
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

  const setActiveIndex = async (id: string) => {
    const res = await fetch("/api/ai-runtime-profiles/active-index", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeIndexProfileId: id }),
    });
    const j = (await res.json()) as { activeIndexProfileId?: string | null; message?: string };
    if (!res.ok) {
      toast.error(j.message || "更新失败");
      return;
    }
    setActiveIndexProfileId(j.activeIndexProfileId ?? null);
    toast.success("已设置全站默认索引模版");
  };

  const creds = gateway?.credentials.filter((c) => c.enabled) ?? [];
  const cid = idxCfg.embed?.credentialId ?? "";
  const model = idxCfg.embed?.model ?? "";
  const k = `${cid}:embed`;
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
        向量嵌入与检索默认参数按模版管理；未单独指定的游戏使用下方「全站默认」。凭证见「
        <a href="/models/credentials" className="text-primary underline underline-offset-2">
          凭证管理
        </a>
        」。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全站：默认索引模版</CardTitle>
          <CardDescription>
            建立索引与 RAG 对话时，若游戏未单独指定索引模版，则使用此套（Embed + 检索参数）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profileList.length === 0 ? (
            <p className="text-muted-foreground text-sm">请先新建至少一套 INDEX 模版。</p>
          ) : (
            <div className="max-w-md">
              <Label className="mb-2 block text-sm">默认模版</Label>
              <Select
                value={activeIndexProfileId ?? profileList[0]!.id}
                onValueChange={(v) => void setActiveIndex(v)}
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
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <CardTitle className="text-base">索引模版</CardTitle>
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
          {!selected || selected.kind !== "INDEX" ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-sm">
                请选择左侧模版或新建
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selected.name}</CardTitle>
                <CardDescription>Embed 槽与 RAG/分块默认（可与游戏级覆盖配合）。</CardDescription>
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
                  <div className="font-medium">Embed 槽位</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>凭证</FieldLabel>
                      <Select
                        value={cid || ""}
                        onValueChange={(v) => {
                          setIdxCfg((c) => ({
                            ...c,
                            embed: {
                              ...c.embed,
                              credentialId: v,
                              model: c.embed.credentialId === v ? c.embed.model : "",
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
                      <FieldLabel>嵌入模型</FieldLabel>
                      <GeminiModelPicker
                        slot="embed"
                        vendor={cid ? (gateway.credentials.find((c) => c.id === cid)?.vendor ?? "gemini") : "gemini"}
                        models={models}
                        value={model}
                        onChange={(v) =>
                          setIdxCfg((c) => ({
                            ...c,
                            embed: { ...c.embed, model: v },
                          }))
                        }
                        loading={Boolean(loadingModels[k])}
                        disabled={!cid}
                      />
                    </Field>
                  </div>
                </div>

                <div className="border-border space-y-6 rounded-lg border p-4">
                  <div>
                    <div className="text-foreground font-medium">检索与分块默认</div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      下列数值会进入建索引与查询时的默认行为；已建立的索引会在 manifest 中记录当时选用的一部分参数。
                      修改分块、BM25 配置、检索模式或元数据后，通常需要<strong>重新建索引</strong>才能在检索侧完全生效（详见 ingestion 文档）。
                    </p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-foreground text-sm font-medium">召回与重排</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>similarityTopK</FieldLabel>
                        <FieldDescription>
                          向量检索阶段从索引中取回的<strong>候选条数上限</strong>（<code className="text-xs">RAG_SIMILARITY_TOP_K</code>
                          ）。数值越大越不易漏召回，但延迟与后续重排成本更高；需要「列全表」类问题时可酌情调高（例如 12–16）。
                        </FieldDescription>
                        <Input
                          type="number"
                          min={1}
                          placeholder={String(INDEX_RAG_DEFAULTS.similarityTopK)}
                          className="tabular-nums"
                          value={ro.similarityTopK ?? ""}
                          onChange={(e) => patchRagNumeric("similarityTopK", e.target.value, 1)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>rerankTopN</FieldLabel>
                        <FieldDescription>
                          经过交叉编码器重排后，实际交给上游（或进入生成上下文）的<strong>条数上限</strong>（
                          <code className="text-xs">RAG_RERANK_TOP_N</code>）。应 ≤ similarityTopK；复杂问答可略增大，但会提高 token 消耗。
                        </FieldDescription>
                        <Input
                          type="number"
                          min={1}
                          placeholder={String(INDEX_RAG_DEFAULTS.rerankTopN)}
                          className="tabular-nums"
                          value={ro.rerankTopN ?? ""}
                          onChange={(e) => patchRagNumeric("rerankTopN", e.target.value, 1)}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-foreground text-sm font-medium">分块（建索引）</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>chunkSize</FieldLabel>
                        <FieldDescription>
                          每个文本块的目标字符规模（<code className="text-xs">CHUNK_SIZE</code>
                          ）。影响向量粒度与 BM25 词面命中；与语种、排版强相关，调整后需重建索引。
                        </FieldDescription>
                        <Input
                          type="number"
                          min={1}
                          placeholder={String(INDEX_RAG_DEFAULTS.chunkSize)}
                          className="tabular-nums"
                          value={ro.chunkSize ?? ""}
                          onChange={(e) => patchRagNumeric("chunkSize", e.target.value, 1)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>chunkOverlap</FieldLabel>
                        <FieldDescription>
                          相邻块之间的重叠长度（<code className="text-xs">CHUNK_OVERLAP</code>
                          ），减少在块边界处被切断的规则句；略增可提高召回稳定性，也会略增存储。
                        </FieldDescription>
                        <Input
                          type="number"
                          min={0}
                          placeholder={String(INDEX_RAG_DEFAULTS.chunkOverlap)}
                          className="tabular-nums"
                          value={ro.chunkOverlap ?? ""}
                          onChange={(e) => patchRagNumeric("chunkOverlap", e.target.value, 0)}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-foreground text-sm font-medium">检索模式与重排开关</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>retrievalMode</FieldLabel>
                        <FieldDescription>
                          <strong>hybrid</strong>：BM25（词面）+ 向量 + RRF 融合（
                          <code className="text-xs">RAG_RETRIEVAL_MODE</code>
                          ）。<strong>vector_only</strong>：仅稠密向量，不做磁盘 BM25；适合纯语义场景或调试。
                        </FieldDescription>
                        <Select
                          value={ro.retrievalMode ?? "hybrid"}
                          onValueChange={(v) =>
                            patchRag({
                              retrievalMode: v === "hybrid" || v === "vector_only" ? v : "hybrid",
                            })
                          }
                        >
                          <SelectTrigger className="cursor-pointer">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hybrid">hybrid（BM25 + 向量）</SelectItem>
                            <SelectItem value="vector_only">vector_only（仅向量）</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <div className="bg-muted/40 flex flex-col justify-end rounded-lg border border-border/60 p-4">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id="useRerank"
                            className="mt-1 shrink-0"
                            checked={ro.useRerank ?? true}
                            onCheckedChange={(v) => patchRag({ useRerank: v === true })}
                          />
                          <div className="min-w-0 space-y-1">
                            <Label htmlFor="useRerank" className="cursor-pointer text-sm font-medium leading-snug">
                              启用交叉编码器重排（useRerank）
                            </Label>
                            <p className="text-muted-foreground text-xs leading-relaxed">
                              关闭后跳过 rerank 模型，仅保留向量 / 混合检索结果，内存与延迟更低，但排序质量可能下降。对应{" "}
                              <code className="text-xs">RAG_USE_RERANK</code>。
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
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
