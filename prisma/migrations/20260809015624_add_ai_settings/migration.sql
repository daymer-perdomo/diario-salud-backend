-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "model" TEXT,
    "apiKeyEncrypted" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
