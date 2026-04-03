-- Store only object keys / relative paths; file bodies live in local storage or Supabase Storage (S3-compatible).
ALTER TABLE "Game" DROP COLUMN IF EXISTS "quickStartGuide";
ALTER TABLE "Game" DROP COLUMN IF EXISTS "startQuestions";
