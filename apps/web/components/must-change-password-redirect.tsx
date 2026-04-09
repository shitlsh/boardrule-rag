"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * JWT 中 mustChangePassword 可能与 DB 短暂不一致（例如管理员刚重置他人密码）；
 * 以 SessionProvider 拉取的会话为准，将用户带回改密页。
 */
export function MustChangePasswordRedirect({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!session?.user?.mustChangePassword) return;
    if (pathname === "/login" || pathname === "/change-password") return;
    router.replace("/change-password");
  }, [session, status, pathname, router]);

  return <>{children}</>;
}
