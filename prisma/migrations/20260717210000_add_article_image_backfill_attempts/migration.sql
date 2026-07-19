-- Pedido explicito del usuario 2026-07-17: job periodico deterministico
-- (sin IA) que reintente recuperar la imagen de un articulo cuando quedo
-- null tras la ingesta inicial (rate-limit transitorio, fetch que fallo
-- una vez, etc -- ver ArticleImageBackfillService). Este contador evita
-- reintentar para siempre un articulo que genuinamente no tiene imagen.
ALTER TABLE "articles" ADD COLUMN "imageBackfillAttempts" INTEGER NOT NULL DEFAULT 0;
