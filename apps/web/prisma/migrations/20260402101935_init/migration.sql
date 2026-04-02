-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coverUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "rulesMarkdownPath" TEXT,
    "quickStartGuidePath" TEXT,
    "startQuestionsPath" TEXT,
    "quickStartGuide" TEXT,
    "startQuestions" TEXT,
    "indexId" TEXT,
    "vectorStoreId" TEXT,
    "extractionStatus" TEXT,
    "extractionJobId" TEXT,
    "pageMetadataEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckpointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
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

-- CreateIndex
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");

-- CreateIndex
CREATE INDEX "Task_gameId_idx" ON "Task"("gameId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
