/// Extrae la URL de una imagen real desde HTML/RSS crudo -- nunca genera
/// ni asume una imagen si la fuente no la provee explicitamente. Se usa
/// desde RssAdapter (content:encoded / description) y HtmlScraperAdapter
/// (HTML de la pagina de detalle).
const IMG_TAG_PATTERN = /<img[^>]+src=["']([^"'>]+)["']/i;

export function extractFirstImageUrl(html: string | null | undefined, baseUrl: string): string | null {
  if (!html) return null;
  const match = html.match(IMG_TAG_PATTERN);
  if (!match) return null;

  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return null;
  }
}
