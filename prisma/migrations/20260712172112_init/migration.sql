-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VALIDATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('RSS', 'HTML_SCRAPE', 'OPEN_DATA_API');

-- CreateEnum
CREATE TYPE "FetchMethod" AS ENUM ('HTTP_SIMPLE', 'HEADLESS_BROWSER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "ArticleState" AS ENUM ('RECOLECTADO', 'DESCARTADO', 'EVALUADO', 'REESCRITO', 'GROUNDING_FALLIDO', 'CUMPLIMIENTO_FALLIDO', 'BORRADOR', 'EN_VALIDACION', 'VALIDADO', 'RECHAZADO', 'PUBLICADO', 'ERROR');

-- CreateEnum
CREATE TYPE "ValidationDecision" AS ENUM ('VALIDADO', 'RECHAZADO', 'EDITADO_Y_VALIDADO');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'AI', 'HUMAN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "institutionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "fetchMethod" "FetchMethod" NOT NULL DEFAULT 'HTTP_SIMPLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cronCadenceMinutes" INTEGER NOT NULL DEFAULT 1440,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessfulCursor" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceInstitution" TEXT NOT NULL,
    "sourcePublishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalTitle" TEXT NOT NULL,
    "originalExcerpt" TEXT,
    "originalContent" TEXT NOT NULL,
    "originalContentHash" TEXT NOT NULL,
    "originalSnapshotUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es',
    "isRelevant" BOOLEAN,
    "relevanceScore" DOUBLE PRECISION,
    "relevanceReason" TEXT,
    "riskLevel" "RiskLevel",
    "riskReason" TEXT,
    "rewrittenTitle" TEXT,
    "rewrittenSummary" TEXT,
    "rewrittenContent" TEXT,
    "rewriteModel" TEXT,
    "rewriteAttempts" INTEGER NOT NULL DEFAULT 0,
    "groundingStatus" "CheckStatus",
    "groundingReport" JSONB,
    "complianceStatus" "CheckStatus",
    "complianceReport" JSONB,
    "state" "ArticleState" NOT NULL DEFAULT 'RECOLECTADO',
    "errorStage" TEXT,
    "lastErrorMessage" TEXT,
    "validatorId" TEXT,
    "validationDecision" "ValidationDecision",
    "validationNotes" TEXT,
    "validatedAt" TIMESTAMP(3),
    "wordpressPostId" INTEGER,
    "wordpressTagIds" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "isDuplicateOf" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "fromState" TEXT,
    "toState" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sources_institutionCode_key" ON "sources"("institutionCode");

-- CreateIndex
CREATE INDEX "articles_state_idx" ON "articles"("state");

-- CreateIndex
CREATE INDEX "articles_sourcePublishedAt_idx" ON "articles"("sourcePublishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "articles_sourceId_originalContentHash_key" ON "articles"("sourceId", "originalContentHash");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_isDuplicateOf_fkey" FOREIGN KEY ("isDuplicateOf") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
