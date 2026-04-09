/** 最小密码长度（自助改密 / 管理员设初始密码） */
export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(plain: string): string | null {
  const p = plain.trim();
  if (p.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`;
  }
  return null;
}
