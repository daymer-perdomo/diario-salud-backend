-- Reemplaza el modelo "cada N minutos" (que causo el incidente de
-- agotamiento de credito del 2026-07-12: RssAdapter sin limite +
-- disparo automatico continuo) por un horario diario opcional a una
-- hora fija. Sin scheduledTime, la fuente es manual-only.
ALTER TABLE "sources" DROP COLUMN "cronCadenceMinutes";
ALTER TABLE "sources" ADD COLUMN "scheduledTime" TEXT;
ALTER TABLE "sources" ALTER COLUMN "nextRunAt" DROP NOT NULL;
ALTER TABLE "sources" ALTER COLUMN "nextRunAt" DROP DEFAULT;

-- Todas las fuentes existentes pasan a manual-only por defecto.
UPDATE "sources" SET "nextRunAt" = NULL;
