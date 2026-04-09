import bcrypt from "bcryptjs";

import { authPgPool } from "@/lib/pg-pool";

export type StaffUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: "admin" | "user";
  disabled: boolean;
  mustChangePassword: boolean;
};

export async function listStaffUsers(): Promise<StaffUserRow[]> {
  const res = await authPgPool.query<{
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    disabled: boolean;
    must_change_password: boolean;
  }>(
    `SELECT id, email, name, role, disabled, must_change_password FROM next_auth.users ORDER BY COALESCE(email, '')`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role === "admin" ? "admin" : "user",
    disabled: r.disabled,
    mustChangePassword: r.must_change_password,
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
    `INSERT INTO next_auth.users (id, name, email, "emailVerified", password_hash, role, disabled, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, NOW(), $3, $4, false, true)
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

/** 管理员重置为新的初始密码：用户下次登录须改密 */
export async function setStaffUserPassword(
  userId: string,
  plainPassword: string,
): Promise<boolean> {
  const hash = await bcrypt.hash(plainPassword, 12);
  const res = await authPgPool.query(
    `UPDATE next_auth.users SET password_hash = $1, must_change_password = true WHERE id = $2`,
    [hash, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getStaffPasswordHash(userId: string): Promise<string | null> {
  const res = await authPgPool.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM next_auth.users WHERE id = $1`,
    [userId],
  );
  return res.rows[0]?.password_hash ?? null;
}

/** 自助改密成功后清除「须改密」标记 */
export async function setPasswordAndClearMustChange(userId: string, plainPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(plainPassword, 12);
  const res = await authPgPool.query(
    `UPDATE next_auth.users SET password_hash = $1, must_change_password = false WHERE id = $2`,
    [hash, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
