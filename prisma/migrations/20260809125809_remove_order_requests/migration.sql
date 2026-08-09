/*
  Warnings:

  - You are about to drop the `order_request_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `order_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "order_request_items" DROP CONSTRAINT "order_request_items_orderRequestId_fkey";

-- DropForeignKey
ALTER TABLE "order_request_items" DROP CONSTRAINT "order_request_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "order_requests" DROP CONSTRAINT "order_requests_sessionId_fkey";

-- DropTable
DROP TABLE "order_request_items";

-- DropTable
DROP TABLE "order_requests";

-- DropEnum
DROP TYPE "OrderRequestStatus";
