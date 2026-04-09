"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const forced = Boolean(session?.user?.mustChangePassword);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  const [current, setCurrent] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nextPw !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: nextPw }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "修改失败");
        return;
      }
      await update({ mustChangePassword: false });
      router.push("/games");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (status === "loading") {
    return <p className="text-muted-foreground text-sm">加载中…</p>;
  }
  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">修改密码</h1>
        <p className="text-muted-foreground text-sm">
          {forced
            ? "当前账号仍在使用初始密码或管理员重置后的密码，请先设置新密码后再使用其他功能。"
            : "可随时在此更新登录密码。"}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{forced ? "设置新密码" : "更改密码"}</CardTitle>
          <CardDescription>新密码至少 {MIN_PASSWORD_LENGTH} 位。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cur">当前密码</Label>
              <Input
                id="cur"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">新密码</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                required
                value={nextPw}
                onChange={(e) => setNextPw(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf">确认新密码</Label>
              <Input
                id="cf"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "提交中…" : "保存"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
