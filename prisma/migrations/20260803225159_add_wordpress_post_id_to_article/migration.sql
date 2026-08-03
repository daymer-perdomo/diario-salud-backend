-- Rastrea si un articulo ya tiene su espejo creado en el WordPress de
-- EcoFarma (wp-json/wp/v2/posts) -- ver WordpressPublishService. Null =
-- pendiente de sincronizar (o WORDPRESS_* no configurado en este entorno).
ALTER TABLE "articles" ADD COLUMN "wordpressPostId" INTEGER;
