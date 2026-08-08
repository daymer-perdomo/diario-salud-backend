-- CreateTable
CREATE TABLE "product_blacklist" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_blacklist_sku_idx" ON "product_blacklist"("sku");

