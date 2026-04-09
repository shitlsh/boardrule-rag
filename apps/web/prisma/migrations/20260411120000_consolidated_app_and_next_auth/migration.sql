-- 初始库结构：Prisma 业务表在 schema `app`；`public` 留给 LangGraph / pgvector 等。
-- Auth.js 使用 schema `next_auth`。

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- app：Game, Task, AppSettings, RateLimit
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

GRANT USAGE ON SCHEMA app TO postgres;
GRANT USAGE ON SCHEMA app TO PUBLIC;

CREATE TABLE app."Game" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coverUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "rulesMarkdownPath" TEXT,
    "quickStartGuidePath" TEXT,
    "startQuestionsPath" TEXT,
    "indexId" TEXT,
    "vectorStoreId" TEXT,
    "extractionStatus" TEXT,
    "extractionJobId" TEXT,
    "pageRasterJobId" TEXT,
    "pagePreviewJson" TEXT,
    "pageMetadataEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckpointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Game_slug_key" ON app."Game"("slug");

CREATE TABLE app."Task" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'EXTRACTION',
    "errorMsg" TEXT,
    "progressJson" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_gameId_idx" ON app."Task"("gameId");

ALTER TABLE app."Task"
  ADD CONSTRAINT "Task_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES app."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE app."AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxImageBytes" INTEGER NOT NULL DEFAULT 10485760,
    "maxPdfBytes" INTEGER NOT NULL DEFAULT 52428800,
    "maxMultiImageFiles" INTEGER NOT NULL DEFAULT 60,
    "maxPdfPages" INTEGER NOT NULL DEFAULT 80,
    "maxGstoneImageUrls" INTEGER NOT NULL DEFAULT 80,
    "pageRasterDpi" INTEGER NOT NULL DEFAULT 150,
    "pageRasterMaxSide" INTEGER NOT NULL DEFAULT 2048,
    "aiGatewayJson" TEXT NOT NULL DEFAULT '{}',
    "wechatConfigJson" TEXT NOT NULL DEFAULT '{}',
    "dailyChatLimit" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO app."AppSettings" (
    "id",
    "maxImageBytes",
    "maxPdfBytes",
    "maxMultiImageFiles",
    "maxPdfPages",
    "maxGstoneImageUrls",
    "pageRasterDpi",
    "pageRasterMaxSide",
    "aiGatewayJson",
    "wechatConfigJson",
    "dailyChatLimit",
    "createdAt",
    "updatedAt"
)
VALUES (
    'default',
    10485760,
    52428800,
    60,
    80,
    80,
    150,
    2048,
    '{}',
    '{}',
    20,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE app."RateLimit" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RateLimit_expiresAt_idx" ON app."RateLimit"("expiresAt");

-- ---------------------------------------------------------------------------
-- next_auth（Auth.js Supabase adapter + 后台 Credentials）
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS next_auth;

GRANT ALL ON SCHEMA next_auth TO postgres;

CREATE TABLE IF NOT EXISTS next_auth.users
(
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text,
    email text,
    "emailVerified" timestamp with time zone,
    image text,
    password_hash text,
    role text NOT NULL DEFAULT 'user',
    disabled boolean NOT NULL DEFAULT false,
    must_change_password boolean NOT NULL DEFAULT false,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT email_unique UNIQUE (email)
);

GRANT ALL ON TABLE next_auth.users TO postgres;

ALTER TABLE next_auth.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE next_auth.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE next_auth.users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
ALTER TABLE next_auth.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION next_auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select
  	coalesce(
		nullif(current_setting('request.jwt.claim.sub', true), ''),
		(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
	)::uuid
$$;

CREATE TABLE IF NOT EXISTS next_auth.sessions
(
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    expires timestamp with time zone NOT NULL,
    "sessionToken" text NOT NULL,
    "userId" uuid,
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessionToken_unique UNIQUE ("sessionToken"),
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

GRANT ALL ON TABLE next_auth.sessions TO postgres;

CREATE TABLE IF NOT EXISTS next_auth.accounts
(
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at bigint,
    token_type text,
    scope text,
    id_token text,
    session_state text,
    oauth_token_secret text,
    oauth_token text,
    "userId" uuid,
    CONSTRAINT accounts_pkey PRIMARY KEY (id),
    CONSTRAINT provider_unique UNIQUE (provider, "providerAccountId"),
    CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

GRANT ALL ON TABLE next_auth.accounts TO postgres;

CREATE TABLE IF NOT EXISTS next_auth.verification_tokens
(
    identifier text,
    token text,
    expires timestamp with time zone NOT NULL,
    CONSTRAINT verification_tokens_pkey PRIMARY KEY (token),
    CONSTRAINT token_unique UNIQUE (token),
    CONSTRAINT token_identifier_unique UNIQUE (token, identifier)
);

GRANT ALL ON TABLE next_auth.verification_tokens TO postgres;

-- Supabase：存在 service_role 时再授权（纯本地 Postgres 可无该角色）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA app TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA app TO service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA next_auth TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA next_auth TO service_role';
  END IF;
END $$;
