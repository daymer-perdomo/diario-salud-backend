/// Imagen de respaldo para articulos sin imageUrl (fuente sin og:image,
/// backfill agotado, etc). Vive en public/assets/post.webp, servido en la
/// raiz por ServeStaticModule (ver AppModule) -- por eso la ruta relativa
/// alcanza, sin necesidad de una URL base absoluta.
///
/// Deliberadamente NO se persiste en Article.imageUrl: el valor en DB debe
/// seguir siendo null para que ArticleImageBackfillService seleccione el
/// articulo como candidato a reintento (ver su where imageUrl: null). El
/// fallback se aplica solo al servir el articulo a un humano o a la API
/// publica.
export const DEFAULT_ARTICLE_IMAGE_URL = '/assets/post.webp';

export function withDefaultImage<T extends { imageUrl: string | null }>(article: T): T {
  return article.imageUrl ? article : { ...article, imageUrl: DEFAULT_ARTICLE_IMAGE_URL };
}
