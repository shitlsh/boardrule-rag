import bcrypt from "bcryptjs";

import { authPgPool } from "@/lib/pg-pool";

export type StaffUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: "admin" | "user";
  disabled: boolean;
};

export async function listStaffUsers(): Promise<StaffUserRow[]> {
  const res = await authPgPool.query<{
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    disabled: boolean;
  }>(
    `SELECT id, email, name, role, disabled FROM next_auth.users ORDER BY COALESCE(email, '')`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role === "admin" ? "admin" : "user",
    disabled: r.disabled,
  }));
}

export async function createStaffUser(params: {
  email: string;
  password: string;
  name?: string | null;
  role: "admin" | "user";
}): Promise<{ id: string }> {
  const email = params.email.trim().toLowerCase();
  const hash = await bcrypt.hash(params.password, 12);
  const res = await authPgPool.query<{ id: string }>(
    `INSERT INTO next_auth.users (id, name, email, "emailVerified", password_hash, role, disabled)
     VALUES (gen_random_uuid(), $1, $2, NOW(), $3, $4, false)
     RETURNING id`,
    [params.name?.trim() || null, email, hash, params.role],
  );
  const row = res.rows[0];
  if (!row) throw new Error("Insert failed");
  return { id: row.id };
}

export async function setStaffUserDisabled(userId: string, disabled: boolean): Promise<boolean> {
  const res = await authPgPool.query(`UPDATE next_auth.users SET disabled = $1 WHERE id = $2`, [
    disabled,
    userId,
  ]);
  return (res.rowCount ?? 0) > 0;
}
