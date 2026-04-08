-- Migration: add_wechat_and_rate_limit
-- Adds WeChat miniapp config + daily chat limit to AppSettings,
-- and creates the RateLimit table for per-user daily counters.

-- AppSettings: new columns (safe to add with defaults, no data loss)
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "wechatConfigJson" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "dailyChatLimit"   INTEGER NOT NULL DEFAULT 20;

-- RateLimit table
CREATE TABLE IF NOT EXISTS "RateLimit" (
  "id"        TEXT        NOT NULL,
  "count"     INTEGER     NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- Index on expiresAt for efficient cleanup queries
CREATE INDEX IF NOT EXISTS "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
