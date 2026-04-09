"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

import { MustChangePasswordRedirect } from "@/components/must-change-password-redirect";

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MustChangePasswordRedirect>{children}</MustChangePasswordRedirect>
    </SessionProvider>
  );
}
