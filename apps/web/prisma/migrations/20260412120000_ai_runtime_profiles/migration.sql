-- CreateEnum
CREATE TYPE "app"."AiRuntimeProfileKind" AS ENUM ('EXTRACTION', 'CHAT');

-- CreateTable
CREATE TABLE "app"."AiRuntimeProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "app"."AiRuntimeProfileKind" NOT NULL,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRuntimeProfile_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "app"."AppSettings" ADD COLUMN "activeChatProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_activeChatProfileId_key" ON "app"."AppSettings"("activeChatProfileId");

-- AddForeignKey
ALTER TABLE "app"."AppSettings" ADD CONSTRAINT "AppSettings_activeChatProfileId_fkey" FOREIGN KEY ("activeChatProfileId") REFERENCES "app"."AiRuntimeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
