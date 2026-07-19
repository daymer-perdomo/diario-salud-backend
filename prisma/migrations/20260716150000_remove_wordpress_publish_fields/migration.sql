-- Decision 2026-07-16: la publicacion ya no depende de WordPress. El
-- backend expone su propia API publica de solo lectura (GET /articles)
-- como destino final -- no hay push hacia un WordPress externo. Se
-- relaja el CHECK que exigia wordpressPostId para llegar a PUBLICADO
-- (ahora solo exige validacion humana, igual que antes) y se eliminan
-- las columnas que ya no tienen consumidor.

ALTER TABLE "articles" DROP CONSTRAINT "publish_requires_validation";

ALTER TABLE "articles" ADD CONSTRAINT "publish_requires_validation"
  CHECK (
    "state" != 'PUBLICADO'
    OR ("validatorId" IS NOT NULL AND "validatedAt" IS NOT NULL)
  );

ALTER TABLE "articles" DROP COLUMN "wordpressPostId";
ALTER TABLE "articles" DROP COLUMN "wordpressTagIds";
