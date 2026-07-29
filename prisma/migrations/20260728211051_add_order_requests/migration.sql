-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('BORRADOR', 'PENDIENTE', 'CONFIRMADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "order_requests" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'BORRADOR',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_items" (
    "id" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_requests_status_createdAt_idx" ON "order_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_request_items_orderRequestId_productId_key" ON "order_request_items"("orderRequestId", "productId");

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

