import * as cheerio from 'cheerio';

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

/// Caso real encontrado 2026-07-17: el feed RSS de SharePoint de Salud
/// Capital no usa <img> en absoluto -- pone la imagen como un enlace
/// directo al archivo (<a href="....jpeg">texto</a>) dentro de la
/// descripcion, con una etiqueta de texto literal "Imagen:"/"enclosure:"
/// que NO es el elemento <enclosure> real de RSS (rss-parser no lo
/// detecta como tal). Como la pagina de detalle (DispForm.aspx) da 401
/// para requests anonimos, el fallback a og:image tampoco sirve aqui --
/// hay que leer la URL real de imagen directamente del <a href> del feed.
const ANCHOR_HREF_PATTERN = /<a[^>]+href=["']([^"'>]+)["']/gi;
const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i;

export function extractFirstImageLinkUrl(html: string | null | undefined, baseUrl: string): string | null {
  if (!html) return null;
  for (const match of html.matchAll(ANCHOR_HREF_PATTERN)) {
    const href = match[1];
    if (!IMAGE_EXTENSION_PATTERN.test(href)) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/// Busca el <meta property="og:image" ...> de la pagina real del
/// articulo -- fallback para cuando el feed RSS no trae ninguna imagen
/// en su propio XML (content:encoded/description/enclosure), pero la
/// pagina si tiene una (caso real: WHO, 2026-07-17 -- el feed no trae
/// imagen, la pagina si via og:image). No asume orden de atributos ni
/// tipo de comilla.
const OG_IMAGE_TAG_PATTERN = /<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i;
const CONTENT_ATTR_PATTERN = /\bcontent=["']([^"']+)["']/i;

export function extractOgImage(html: string | null | undefined, baseUrl: string): string | null {
  if (!html) return null;
  const tagMatch = html.match(OG_IMAGE_TAG_PATTERN);
  if (!tagMatch) return null;
  const contentMatch = tagMatch[0].match(CONTENT_ATTR_PATTERN);
  if (!contentMatch) return null;

  try {
    return new URL(contentMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
}

/// Cadena compartida para extraer la imagen de UNA pagina de detalle ya
/// descargada: 1) og:image, 2) si se pasa un selector CSS calibrado a
/// mano para la fuente (Source.config.detailImageSelector, ver
/// HtmlScraperAdapter), la primera <img> dentro de ese selector. Usada
/// por HtmlScraperAdapter.enrichWithDetailImage (fetch inicial) Y por
/// ArticleImageBackfillService (reintento periodico, sin IA, sobre
/// articulos que quedaron con imageUrl null) -- misma logica, un solo
/// lugar para no divergir entre el intento inicial y el reintento.
export function extractDetailPageImage(html: string, pageUrl: string, detailSelector?: string | null): string | null {
  const fromOgImage = extractOgImage(html, pageUrl);
  if (fromOgImage) return fromOgImage;
  if (!detailSelector) return null;

  const $ = cheerio.load(html);
  const src = $(detailSelector).find('img').first().attr('src') ?? $(detailSelector).first().attr('src');
  if (!src) return null;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}
