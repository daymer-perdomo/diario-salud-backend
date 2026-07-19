-- Pedido explicito del usuario 2026-07-17: mostrar que fuente se esta
-- consultando en este momento dentro de una corrida, paso a paso -- no
-- solo el resumen final (ver comentario de IngestionRunSource en el
-- schema).

-- CreateEnum
CREATE TYPE "IngestionRunSourceStatus" AS ENUM ('PENDIENTE', 'EN_CURSO', 'COMPLETADO', 'ERROR');

-- CreateTable
CREATE TABLE "ingestion_run_sources" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "institutionCode" TEXT NOT NULL,
    "status" "IngestionRunSourceStatus" NOT NULL DEFAULT 'PENDIENTE',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "itemsCreated" INTEGER,
    "itemsDuplicate" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_run_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_run_sources_runId_sourceId_key" ON "ingestion_run_sources"("runId", "sourceId");

-- AddForeignKey
ALTER TABLE "ingestion_run_sources" ADD CONSTRAINT "ingestion_run_sources_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ingestion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_run_sources" ADD CONSTRAINT "ingestion_run_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
