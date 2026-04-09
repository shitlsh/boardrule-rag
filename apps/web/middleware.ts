import { NextResponse } from "next/server";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Edge 中不得导入 @/auth（含 bcrypt / pg / Supabase adapter），否则触发 Node crypto 报错
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const loggedIn = !!req.auth;
  const user = req.auth?.user as
    | { role?: string; mustChangePassword?: boolean }
    | undefined;
  const role = user?.role;
  const mustChangePassword = Boolean(user?.mustChangePassword);

  if (path === "/login") {
    if (loggedIn) {
      const dest = mustChangePassword ? "/change-password" : "/games";
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return NextResponse.next();
  }

  if (path === "/change-password") {
    if (!loggedIn) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  if (!loggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (mustChangePassword) {
    return NextResponse.redirect(new URL("/change-password", req.url));
  }

  if (path === "/settings/users" || path.startsWith("/settings/users/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/users" + path.slice("/settings/users".length);
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/users") && role !== "admin") {
    return NextResponse.redirect(new URL("/games", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
