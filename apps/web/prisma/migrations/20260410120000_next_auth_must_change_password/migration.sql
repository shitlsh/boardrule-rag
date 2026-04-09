-- 首次登录或管理员重置后须修改密码
ALTER TABLE next_auth.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
