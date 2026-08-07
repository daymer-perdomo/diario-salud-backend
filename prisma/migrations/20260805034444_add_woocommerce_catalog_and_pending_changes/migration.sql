-- CreateEnum
CREATE TYPE "WoocommercePendingKind" AS ENUM ('VISIBILITY', 'STOCK_STATUS');

-- CreateEnum
CREATE TYPE "WoocommercePendingStatus" AS ENUM ('PENDIENTE', 'APLICADO', 'FALLIDO');

-- CreateTable
CREATE TABLE "woocommerce_catalog_items" (
    "id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "imageUrl" TEXT,
    "stockStatus" TEXT NOT NULL,
    "catalogVisibility" TEXT NOT NULL,
    "manageStock" BOOLEAN NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "woocommerce_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "woocommerce_pending_changes" (
    "id" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" "WoocommercePendingKind" NOT NULL,
    "value" BOOLEAN NOT NULL,
    "status" "WoocommercePendingStatus" NOT NULL DEFAULT 'PENDIENTE',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "requestedByUserId" TEXT,

    CONSTRAINT "woocommerce_pending_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "woocommerce_catalog_items_sku_idx" ON "woocommerce_catalog_items"("sku");

-- CreateIndex
CREATE INDEX "woocommerce_catalog_items_name_idx" ON "woocommerce_catalog_items"("name");

-- CreateIndex
CREATE INDEX "woocommerce_pending_changes_status_createdAt_idx" ON "woocommerce_pending_changes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "woocommerce_pending_changes_productId_idx" ON "woocommerce_pending_changes"("productId");

