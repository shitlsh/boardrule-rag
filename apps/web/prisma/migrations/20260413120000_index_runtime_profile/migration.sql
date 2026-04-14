-- INDEX profile kind + per-game / default index template selection
ALTER TYPE "app"."AiRuntimeProfileKind" ADD VALUE 'INDEX';

ALTER TABLE "app"."Game" ADD COLUMN "indexProfileId" TEXT;

ALTER TABLE "app"."AppSettings" ADD COLUMN "activeIndexProfileId" TEXT;

CREATE UNIQUE INDEX "AppSettings_activeIndexProfileId_key" ON "app"."AppSettings"("activeIndexProfileId");

ALTER TABLE "app"."Game" ADD CONSTRAINT "Game_indexProfileId_fkey" FOREIGN KEY ("indexProfileId") REFERENCES "app"."AiRuntimeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "app"."AppSettings" ADD CONSTRAINT "AppSettings_activeIndexProfileId_fkey" FOREIGN KEY ("activeIndexProfileId") REFERENCES "app"."AiRuntimeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
