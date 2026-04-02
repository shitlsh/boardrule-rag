import Link from "next/link";

import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-foreground">未找到游戏</h1>
      <p className="mt-2 text-sm text-muted-foreground">该链接可能已失效，或记录已被删除。</p>
      <Link
        href="/games"
        className={cn(
          "mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
          "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        返回游戏列表
      </Link>
    </div>
  );
}
