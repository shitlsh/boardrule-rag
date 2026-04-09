-- C-end global daily chat cap (all miniapp traffic, UTC day).
ALTER TABLE app."AppSettings" ADD COLUMN "dailyChatLimitGlobal" INTEGER NOT NULL DEFAULT 1000;
