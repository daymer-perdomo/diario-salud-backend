-- Invariantes estructurales de la maquina de estados (ver plan de arquitectura).
-- Estos CHECK constraints son el respaldo final: incluso un bug en
-- ArticleStateMachineService o una correccion manual por SQL no puede
-- dejar un articulo en estado PUBLICADO sin validacion humana, ni en
-- estado de borrador/validacion sin haber pasado grounding y compliance.

-- 1) No se puede publicar sin validador humano, fecha de validacion y post de WordPress ya creado.
ALTER TABLE "articles" ADD CONSTRAINT "publish_requires_validation"
  CHECK (
    "state" != 'PUBLICADO'
    OR ("validatorId" IS NOT NULL AND "validatedAt" IS NOT NULL AND "wordpressPostId" IS NOT NULL)
  );

-- 2) No se puede llegar a borrador/validacion/publicado sin que grounding y
--    cumplimiento normativo hayan sido APROBADO explicitamente.
--    NOTA: se usa IS NOT NULL antes de la comparacion de igualdad a proposito.
--    En SQL, "columna_nula = 'APROBADO'" evalua a NULL (no a FALSE), y un
--    CHECK solo bloquea la fila cuando el resultado es FALSE -- con NULL la
--    fila pasaria sin ser detectada. Verificado con una insercion de prueba
--    directa antes de fijar esta version.
ALTER TABLE "articles" ADD CONSTRAINT "draft_requires_clean_checks"
  CHECK (
    "state" NOT IN ('BORRADOR', 'EN_VALIDACION', 'VALIDADO', 'PUBLICADO')
    OR (
      "groundingStatus" IS NOT NULL AND "groundingStatus" = 'APROBADO'
      AND "complianceStatus" IS NOT NULL AND "complianceStatus" = 'APROBADO'
    )
  );

-- 3) Procedencia obligatoria: un articulo sin URL/institucion/fecha de fuente
--    no debe poder existir. (Las columnas ya son NOT NULL por el schema de
--    Prisma; este CHECK adicional bloquea ademas valores vacios/en blanco,
--    que NOT NULL por si solo no evita.)
ALTER TABLE "articles" ADD CONSTRAINT "provenance_not_blank"
  CHECK (
    length(trim("sourceUrl")) > 0
    AND length(trim("sourceInstitution")) > 0
    AND length(trim("originalContent")) > 0
    AND length(trim("originalContentHash")) > 0
  );
