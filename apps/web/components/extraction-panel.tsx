"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Link2, Loader2, Play, Upload } from "lucide-react";
import { toast } from "sonner";

import { PageThumbnailPicker, type PagePickRole } from "@/components/page-thumbnail-picker";
import { PageThumbnails } from "@/components/page-thumbnails";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useExtractionTasks, usePageThumbnails } from "@/hooks/use-game";
import type { Game } from "@/lib/types";

interface ExtractionPanelProps {
  game: Game;
  onUpdate: () => void;
}

type SourceTab = "pdf" | "images" | "gstone";

type RulebookLimits = {
  maxImageBytes: number;
  maxPdfBytes: number;
  maxMultiImageFiles: number;
  maxPdfPages: number;
  maxGstoneImageUrls: number;
  pageRasterDpi: number;
  pageRasterMaxSide: number;
};

function cycleRole(current: PagePickRole): PagePickRole {
  if (current === "none") return "toc";
  if (current === "toc") return "exclude";
  return "none";
}

export function ExtractionPanel({ game, onUpdate }: ExtractionPanelProps) {
  const { pages, isLoading: pagesLoading, mutate: mutatePages } = usePageThumbnails(game.id);
  const { tasks, isLoading: tasksLoading } = useExtractionTasks(game.id);

  const [tab, setTab] = useState<SourceTab>("pdf");
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [terminologyContext, setTerminologyContext] = useState("");
  const [forceFullPipeline, setForceFullPipeline] = useState(false);
  const [roleByPage, setRoleByPage] = useState<Record<number, PagePickRole>>({});

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [gstoneUrl, setGstoneUrl] = useState("");
  const [gstonePreviewUrls, setGstonePreviewUrls] = useState<string[] | null>(null);
  const [gstoneExcluded, setGstoneExcluded] = useState<Set<number>>(new Set());
  const [loadingGstonePreview, setLoadingGstonePreview] = useState(false);
  const [limits, setLimits] = useState<RulebookLimits | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRoleByPage({});
  }, [game.paginationJobId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setLimits(data as RulebookLimits);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleGstoneExcluded = (index: number) => {
    setGstoneExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCyclePageRole = (pageNumber: number) => {
    setRoleByPage((prev) => {
      const cur = prev[pageNumber] ?? "none";
      return { ...prev, [pageNumber]: cycleRole(cur) };
    });
  };

  async function uploadPdfWithPresignFallback(file: File): Promise<void> {
    const signRes = await fetch(`/api/games/${game.id}/upload-sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name }),
    });
    if (signRes.ok) {
      const j = (await signRes.json()) as {
        signedUrl: string;
        relativePath: string;
      };
      const put = await fetch(j.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/pdf" },
      });
      if (!put.ok) {
        throw new Error(`直传存储失败: ${put.status}`);
      }
      const fin = await fetch(`/api/games/${game.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pdf", storageKey: j.relativePath }),
      });
      if (!fin.ok) {
        const err = await fin.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "分页失败");
      }
      return;
    }
    const fd = new FormData();
    fd.append("mode", "pdf");
    fd.append("file", file);
    const res = await fetch(`/api/games/${game.id}/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || "上传失败");
    }
  }

  async function uploadImagesWithPresignFallback(files: File[]): Promise<void> {
    const signRes = await fetch(`/api/games/${game.id}/upload-sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: files[0]?.name ?? "image.png" }),
    });
    if (signRes.ok) {
      const keys: string[] = [];
      for (const f of files) {
        const s = await fetch(`/api/games/${game.id}/upload-sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: f.name }),
        });
        if (!s.ok) throw new Error("无法获取上传凭证");
        const j = (await s.json()) as { signedUrl: string; relativePath: string };
        const put = await fetch(j.signedUrl, {
          method: "PUT",
          body: f,
          headers: { "Content-Type": f.type || "image/png" },
        });
        if (!put.ok) throw new Error(`直传失败: ${put.status}`);
        keys.push(j.relativePath);
      }
      const fin = await fetch(`/api/games/${game.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "images", storageKeys: keys }),
      });
      if (!fin.ok) {
        const err = await fin.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "分页失败");
      }
      return;
    }
    const fd = new FormData();
    fd.append("mode", "images");
    for (const f of files) {
      fd.append("files", f);
    }
    const res = await fetch(`/api/games/${game.id}/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message || "上传失败");
    }
  }

  const handleLoadGstonePreview = async () => {
    const u = gstoneUrl.trim();
    if (!u) {
      toast.error("请填写集石页面 URL");
      return;
    }
    setLoadingGstonePreview(true);
    try {
      const res = await fetch(`/api/games/${game.id}/rule-image-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: u }),
      });
      const json = (await res.json()) as { urls?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error || "加载预览失败");
      const urls = json.urls ?? [];
      if (urls.length === 0) throw new Error("未解析到规则图片");
      setGstonePreviewUrls(urls);
      setGstoneExcluded(new Set());
      toast.success("已加载预览，可剔除不需要的页后再确认分页");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingGstonePreview(false);
    }
  };

  const handleConfirmPagination = async () => {
    setIsUploading(true);
    try {
      if (tab === "pdf") {
        if (!pdfFile) {
          toast.error("请选择 PDF 文件");
          return;
        }
        if (limits && pdfFile.size > limits.maxPdfBytes) {
          toast.error(
            `PDF 超过单文件上限（约 ${(limits.maxPdfBytes / (1024 * 1024)).toFixed(0)} MiB，可在系统设置调整）`,
          );
          return;
        }
        await uploadPdfWithPresignFallback(pdfFile);
      } else if (tab === "images") {
        if (imageFiles.length === 0) {
          toast.error("请至少选择一张图片");
          return;
        }
        if (limits) {
          if (imageFiles.length > limits.maxMultiImageFiles) {
            toast.error(`一次最多 ${limits.maxMultiImageFiles} 张图片（系统设置可调整）`);
            return;
          }
          for (const f of imageFiles) {
            if (f.size > limits.maxImageBytes) {
              toast.error(
                `图片 ${f.name || "未命名"} 超过单张上限（约 ${(limits.maxImageBytes / (1024 * 1024)).toFixed(0)} MiB）`,
              );
              return;
            }
          }
        }
        await uploadImagesWithPresignFallback(imageFiles);
      } else {
        const u = gstoneUrl.trim();
        if (!u) {
          toast.error("请填写集石 URL");
          return;
        }
        const fd = new FormData();
        fd.append("mode", "gstone");
        fd.append("sourceUrl", u);
        fd.append("excludedIndices", JSON.stringify(Array.from(gstoneExcluded).sort((a, b) => a - b)));
        const res = await fetch(`/api/games/${game.id}/upload`, { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message || "分页失败");
        }
      }
      toast.success("规则书已提交分页");
      setPdfFile(null);
      setImageFiles([]);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      if (imagesInputRef.current) imagesInputRef.current.value = "";
      mutatePages();
      onUpdate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartExtraction = async () => {
    const tocPages = pages
      .filter((p) => (roleByPage[p.pageNumber] ?? "none") === "toc")
      .map((p) => p.pageNumber)
      .sort((a, b) => a - b)
      .join(",");
    const excludePages = pages
      .filter((p) => (roleByPage[p.pageNumber] ?? "none") === "exclude")
      .map((p) => p.pageNumber)
      .sort((a, b) => a - b)
      .join(",");

    setIsExtracting(true);
    try {
      const res = await fetch(`/api/games/${game.id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tocPages: tocPages || undefined,
          excludePages: excludePages || undefined,
          terminologyContext: terminologyContext.trim() || undefined,
          forceFullPipeline: forceFullPipeline || undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error((error as { message?: string }).message || "启动提取失败");
      }
      toast.success("规则提取任务已启动");
      onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动提取失败，请重试");
    } finally {
      setIsExtracting(false);
    }
  };

  const hasPagination = !!game.paginationJobId;
  const isProcessing = game.extractionStatus === "processing";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            步骤一：规则来源与分页
          </CardTitle>
          <CardDescription>
            选择 PDF、多张图片或集石链接；确认后再提交分页（大文件可直传 Storage，不经 Vercel 请求体）。
            {limits ? (
              <span className="mt-1 block text-xs">
                当前限制：PDF ≤ {(limits.maxPdfBytes / (1024 * 1024)).toFixed(0)} MiB，单图 ≤{" "}
                {(limits.maxImageBytes / (1024 * 1024)).toFixed(0)} MiB，多图 ≤ {limits.maxMultiImageFiles}{" "}
                张，分页后总页数 ≤ {limits.maxPdfPages}，集石链接 ≤ {limits.maxGstoneImageUrls}（可在
                <a href="/settings" className="underline underline-offset-2">
                  系统设置
                </a>
                调整）。
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)}>
            <TabsList>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="images">多图</TabsTrigger>
              <TabsTrigger value="gstone">集石 URL</TabsTrigger>
            </TabsList>

            <TabsContent value="pdf" className="space-y-3 pt-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPdfFile(f ?? null);
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" type="button" onClick={() => pdfInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  选择 PDF
                </Button>
                {pdfFile ? (
                  <span className="text-sm text-muted-foreground">{pdfFile.name}</span>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="images" className="space-y-3 pt-2">
              <input
                ref={imagesInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files ? Array.from(e.target.files) : [];
                  setImageFiles(list);
                }}
              />
              <Button variant="outline" type="button" onClick={() => imagesInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                选择多张图片
              </Button>
              {imageFiles.length > 0 ? (
                <p className="text-sm text-muted-foreground">已选 {imageFiles.length} 张</p>
              ) : null}
            </TabsContent>

            <TabsContent value="gstone" className="space-y-3 pt-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="url"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="https://www.gstonegames.com/..."
                  value={gstoneUrl}
                  onChange={(e) => {
                    setGstoneUrl(e.target.value);
                    setGstonePreviewUrls(null);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleLoadGstonePreview}
                  disabled={loadingGstonePreview}
                >
                  {loadingGstonePreview ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  加载预览
                </Button>
              </div>
              {gstonePreviewUrls && gstonePreviewUrls.length > 0 ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    勾选要剔除的页（不参与分页）；其余在确认分页时下载并提交引擎。
                  </p>
                  <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {gstonePreviewUrls.map((url, i) => (
                      <label
                        key={`${i}-${url.slice(-32)}`}
                        className="flex cursor-pointer flex-col gap-1 rounded border bg-background p-1 text-xs"
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-muted">
                          <img
                            src={url}
                            alt=""
                            className="h-full w-full object-contain"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <span className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={gstoneExcluded.has(i)}
                            onChange={() => toggleGstoneExcluded(i)}
                          />
                          剔除第 {i + 1} 页
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleConfirmPagination}
              disabled={
                isUploading ||
                (tab === "pdf" && !pdfFile) ||
                (tab === "images" && imageFiles.length === 0) ||
                (tab === "gstone" && !gstoneUrl.trim())
              }
            >
              {isUploading ? (
                <>
                  <Spinner className="mr-2" />
                  处理中…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  确认并分页
                </>
              )}
            </Button>
            {hasPagination ? (
              <span className="text-sm text-muted-foreground">已有分页数据，重新确认将覆盖</span>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">分页预览</p>
            <PageThumbnails pages={pages} isLoading={pagesLoading} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>步骤二：目录与排除（点选缩略图）</CardTitle>
          <CardDescription>
            在分页完成后，点选目录页与需排除的广告/全图页；也可填写术语上下文。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PageThumbnailPicker
            pages={pages}
            isLoading={pagesLoading}
            roleByPage={roleByPage}
            onCycleRole={handleCyclePageRole}
          />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="terminologyContext">术语上下文（可选）</FieldLabel>
              <Textarea
                id="terminologyContext"
                placeholder="输入游戏相关的术语说明，帮助 AI 更准确理解规则"
                value={terminologyContext}
                onChange={(e) => setTerminologyContext(e.target.value)}
                disabled={isExtracting || isProcessing}
                rows={3}
              />
            </Field>
            <Field className="flex flex-row items-start gap-3 space-y-0">
              <Checkbox
                id="forceFullPipeline"
                checked={forceFullPipeline}
                onCheckedChange={(v) => setForceFullPipeline(v === true)}
                disabled={isExtracting || isProcessing}
              />
              <div className="grid gap-1.5 leading-none">
                <FieldLabel htmlFor="forceFullPipeline" className="cursor-pointer font-normal">
                  强制全量流程
                </FieldLabel>
                <p className="text-xs text-muted-foreground">
                  跳过「薄册简单路径」，始终按复杂规则书分流与分批（用于厚册或与旧多阶段管线对齐排查）。
                </p>
              </div>
            </Field>
          </FieldGroup>
          <Button onClick={handleStartExtraction} disabled={!hasPagination || isExtracting || isProcessing}>
            {isExtracting || isProcessing ? (
              <>
                <Spinner className="mr-2" />
                处理中...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                开始提取
              </>
            )}
          </Button>
          {!hasPagination ? (
            <p className="mt-2 text-sm text-muted-foreground">请先在步骤一完成分页</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务状态</CardTitle>
          <CardDescription>查看提取任务的执行进度</CardDescription>
        </CardHeader>
        <CardContent>
          <TaskList tasks={tasks} isLoading={tasksLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
