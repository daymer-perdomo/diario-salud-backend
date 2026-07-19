-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ALERTA', 'PREVENCION', 'VIGILANCIA');

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "contentType" "ContentType";

