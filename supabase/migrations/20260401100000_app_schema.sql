-- Prisma 业务表所在 schema（Game / Task / AppSettings / RateLimit）。
-- config.toml 将 app 列入 api.schemas 时，PostgREST 启动前该 schema 必须已存在。
-- 具体建表由 apps/web 的 Prisma 迁移负责；此处仅 CREATE SCHEMA。
CREATE SCHEMA IF NOT EXISTS app;

GRANT USAGE ON SCHEMA app TO postgres, anon, authenticated, service_role;
