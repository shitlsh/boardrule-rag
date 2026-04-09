import { NextResponse } from "next/server";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Edge 中不得导入 @/auth（含 bcrypt / pg / Supabase adapter），否则触发 Node crypto 报错
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const loggedIn = !!req.auth;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  if (path === "/login") {
    if (loggedIn) {
      return NextResponse.redirect(new URL("/games", req.url));
    }
    return NextResponse.next();
  }

  if (!loggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (path.startsWith("/settings/users") && role !== "admin") {
    return NextResponse.redirect(new URL("/games", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
