-- CreateEnum
CREATE TYPE "InventorySyncStatus" AS ENUM ('EN_CURSO', 'COMPLETADO', 'FALLIDO');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "externalUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "invimaRegistration" TEXT,
ADD COLUMN     "labName" TEXT,
ADD COLUMN     "supplierCode" TEXT;

-- CreateTable
CREATE TABLE "inventory_sync_runs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DISTRIMONACO_API',
    "status" "InventorySyncStatus" NOT NULL DEFAULT 'EN_CURSO',
    "itemsSynced" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_sync_runs_startedAt_idx" ON "inventory_sync_runs"("startedAt");

