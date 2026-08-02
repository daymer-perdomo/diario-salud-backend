-- CreateTable
CREATE TABLE "woocommerce_hidden_products" (
    "id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "woocommerce_hidden_products_pkey" PRIMARY KEY ("id")
);
