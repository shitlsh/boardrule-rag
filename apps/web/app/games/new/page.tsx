"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function NewGamePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("请输入游戏名称");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          coverUrl: coverUrl.trim() || undefined,
        }),
      });

      const data = (await res.json()) as { message?: string; game?: { id: string }; error?: string };

      if (!res.ok) {
        throw new Error(data.message || data.error || "创建失败");
      }

      const id = data.game?.id;
      if (!id) {
        throw new Error("响应缺少 game.id");
      }

      toast.success("游戏创建成功");
      router.push(`/games/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/games">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">新建游戏</h1>
          <p className="text-muted-foreground">添加一个新的桌游规则书</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>游戏信息</CardTitle>
          <CardDescription>填写基本信息以创建游戏</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">游戏名称 *</FieldLabel>
                <Input
                  id="name"
                  placeholder="例如：卡坦岛、璀璨宝石"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="coverUrl">封面图片 URL（可选）</FieldLabel>
                <Input
                  id="coverUrl"
                  type="url"
                  placeholder="https://example.com/cover.jpg"
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </Field>
            </FieldGroup>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="outline" asChild disabled={isSubmitting}>
                <Link href="/games">取消</Link>
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Spinner className="mr-2" /> : null}
                创建游戏
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
