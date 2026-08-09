-- AlterTable
ALTER TABLE "articles" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");
