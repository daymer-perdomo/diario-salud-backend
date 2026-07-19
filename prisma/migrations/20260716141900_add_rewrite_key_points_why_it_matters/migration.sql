-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "rewrittenKeyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rewrittenWhyItMatters" TEXT;

