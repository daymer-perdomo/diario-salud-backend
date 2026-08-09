-- CreateEnum
CREATE TYPE "BlogReviewDecision" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "internalLinksNotes" TEXT,
ADD COLUMN     "intro" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "reviewDecision" "BlogReviewDecision" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "sourcesConsultadas" TEXT;

-- CreateIndex
CREATE INDEX "blog_posts_contentType_idx" ON "blog_posts"("contentType");
