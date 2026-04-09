import NextAuth from "next-auth";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { authConfig } from "@/auth.config";
import { authPgPool } from "@/lib/pg-pool";

function supabaseAdapter() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Auth.js (Supabase adapter).",
    );
  }
  return SupabaseAdapter({ url, secret });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as "admin" | "user") ?? "user";
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
      }
      const uid = session.user?.id;
      if (uid) {
        const r = await authPgPool.query<{ must_change_password: boolean }>(
          `SELECT must_change_password FROM next_auth.users WHERE id = $1`,
          [uid],
        );
        const db = r.rows[0]?.must_change_password;
        if (typeof db === "boolean" && session.user) {
          session.user.mustChangePassword = db;
        }
      }
      return session;
    },
  },
  adapter: supabaseAdapter(),
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toString().trim().toLowerCase();
        const password = credentials?.password?.toString() ?? "";
        if (!email || !password) return null;

        const res = await authPgPool.query<{
          id: string;
          email: string | null;
          name: string | null;
          image: string | null;
          password_hash: string | null;
          role: string;
          disabled: boolean;
          must_change_password: boolean;
        }>(
          `SELECT id, email, name, image, password_hash, role, disabled, must_change_password
           FROM next_auth.users WHERE email = $1`,
          [email],
        );
        const row = res.rows[0];
        if (!row || row.disabled || !row.password_hash) return null;
        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) return null;

        return {
          id: row.id,
          email: row.email ?? undefined,
          name: row.name ?? undefined,
          image: row.image ?? undefined,
          role: row.role === "admin" ? "admin" : "user",
          mustChangePassword: row.must_change_password,
        };
      },
    }),
  ],
});
