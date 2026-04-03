-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxImageBytes" INTEGER NOT NULL DEFAULT 10485760,
    "maxPdfBytes" INTEGER NOT NULL DEFAULT 52428800,
    "maxMultiImageFiles" INTEGER NOT NULL DEFAULT 60,
    "maxPdfPages" INTEGER NOT NULL DEFAULT 80,
    "maxGstoneImageUrls" INTEGER NOT NULL DEFAULT 80,
    "pageRasterDpi" INTEGER NOT NULL DEFAULT 150,
    "pageRasterMaxSide" INTEGER NOT NULL DEFAULT 2048,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSettings" ("id", "maxImageBytes", "maxPdfBytes", "maxMultiImageFiles", "maxPdfPages", "maxGstoneImageUrls", "pageRasterDpi", "pageRasterMaxSide", "createdAt", "updatedAt")
VALUES ('default', 10485760, 52428800, 60, 80, 80, 150, 2048, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
