import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * 仅含 Edge 可运行的依赖（供 middleware 使用）。
 * 真实 `authorize`（bcrypt + pg）在 auth.ts 中覆盖，避免 Edge 打包 Node 模块。
 * @see https://authjs.dev/guides/edge
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      // middleware 不执行登录；占位避免 Edge 拉取 bcrypt/pg
      async authorize() {
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: "admin" | "user" }).role ?? "user";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as "admin" | "user") ?? "user";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
