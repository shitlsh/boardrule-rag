import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "user";
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "admin" | "user";
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "admin" | "user";
    mustChangePassword?: boolean;
  }
}
