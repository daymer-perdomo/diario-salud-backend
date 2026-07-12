/// Un item crudo devuelto por un adapter, todavia sin persistir. El
/// contentHash se calcula sobre el texto normalizado (originalTitle +
/// rawText) para deduplicar antes de crear la fila Article.
export interface RawCandidate {
  externalId: string | null;
  url: string;
  title: string;
  excerpt: string | null;
  publishedAt: Date;
  rawText: string;
  contentHash: string;
  /// URL de una imagen oficial asociada al item, si la fuente la expone
  /// (enclosure/media:content en RSS, <img> embebido en content:encoded,
  /// og:image en HTML). null si la fuente no trae imagen -- nunca se
  /// inventa ni se usa un placeholder generico.
  imageUrl: string | null;
}

export interface FetchResult {
  items: RawCandidate[];
  /// Cursor opaco para la proxima corrida (fecha, numero de pagina, etc.),
  /// se persiste en Source.lastSuccessfulCursor. null si la fuente no
  /// soporta/necesita cursor (p.ej. un feed RSS que siempre trae todo).
  nextCursor: unknown | null;
}
