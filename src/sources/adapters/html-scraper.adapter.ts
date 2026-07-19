import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import got from 'got';
import { Source, SourceType, FetchMethod } from '@prisma/client';
import { SourceAdapter } from '../interfaces/source-adapter.interface';
import { FetchResult, RawCandidate } from '../interfaces/raw-candidate.interface';
import { computeContentHash } from '../../common/content-hash.util';
import { HttpFetcherFactory } from '../fetchers/http-fetcher.factory';
import { HttpFetcher } from '../fetchers/http-fetcher.interface';
import { DomainRateLimiterService } from '../fetchers/domain-rate-limiter.service';
import { extractDetailPageImage } from './image-extraction.util';

const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require('pdf-parse');

/// Config esperada en Source.config para type=HTML_SCRAPE. Selectores y
/// paginacion son datos de configuracion, no codigo -- una fuente nueva
/// del mismo tipo se agrega con una fila en el catalogo, sin tocar este
/// archivo. Los valores para INVIMA fueron verificados contra el HTML real
/// de https://app.invima.gov.co/alertas/alertas-sanitarias-general
/// (Drupal Views, servido sin JS). El resto de fuentes HTML_SCRAPE del
/// catalogo (Minsalud, Supersalud, ADRES, ICBF, DANE) necesitan la misma
/// calibracion manual antes de activarse -- ver seed-data, quedan con
/// isActive=false hasta confirmar sus selectores igual que se hizo aqui.
export interface HtmlScraperSourceConfig {
  listingUrl: string;
  itemSelector: string;
  titleSelector: string;
  /// Selector del enlace al documento/detalle. Si termina en un PDF, se
  /// descarga y se extrae el texto con pdf-parse en vez de usar el HTML
  /// de la fila como contenido (los listados de gobierno suelen tener
  /// solo metadatos, el contenido real vive en el PDF vinculado).
  linkSelector: string;
  dateSelector: string;
  docTypeSelector?: string;
  /// Selector de la imagen dentro de la fila del listado (ej. un
  /// thumbnail), si el sitio la muestra ahi. Opcional -- si no esta
  /// configurado o el sitio no tiene imagen (como INVIMA, cuyo listado
  /// solo trae texto+enlace a PDF), imageUrl queda en null.
  imageSelector?: string;
  /// Selector de la imagen dentro de la PAGINA DE DETALLE del articulo
  /// (no la fila del listado) -- fallback usado cuando ni imageSelector
  /// ni el <meta property="og:image"> de esa pagina traen nada (ver
  /// enrichWithOgImage). Verificado en vivo para ADRES 2026-07-17: sus
  /// paginas SharePoint no traen og:image, pero la imagen real del
  /// articulo esta dentro de .ms-rtestate-field (el contenedor de texto
  /// enriquecido) -- confirmado contra 3 articulos reales, siempre la
  /// primera <img> de ese contenedor es la imagen del articulo, nunca un
  /// icono/logo del sitio (esos quedan fuera de ese div). Se toma
  /// deliberadamente distinto de "agarrar la primera <img> de toda la
  /// pagina", que si agarraria iconos de SharePoint.
  detailImageSelector?: string;
  pagination?: {
    nextPageSelector: string;
    maxPagesPerRun: number;
  };
  /// Tope duro de items por corrida, aplicado tras recorrer las paginas
  /// configuradas -- misma idea que maxItemsPerFeed en RssAdapter (ver su
  /// comentario sobre el incidente de agotamiento de credito del
  /// 2026-07-12). Sin este tope, un listado con muchos items en una sola
  /// pagina (ej. ADRES: 327 en /sala-de-prensa/noticias) se ingeriria y
  /// puntuaria con IA de una sola vez sin limite.
  maxItemsPerRun?: number;
  /// Ventana de recencia en dias -- filtra por dateSelector ANTES de
  /// aplicar maxItemsPerRun, igual que maxAgeDays en RssAdapter. Antes de
  /// esto, HTML_SCRAPE no tenia ningun filtro por fecha, solo por conteo.
  maxAgeDays?: number;
}

/// Bajado de 30 a 3 el 2026-07-17 -- ver comentario equivalente en
/// RssAdapter.
const DEFAULT_MAX_ITEMS_PER_RUN = 3;
/// Bajado de 30 a 3 el 2026-07-17 -- ver comentario equivalente en
/// RssAdapter.
const DEFAULT_MAX_AGE_DAYS = 3;

@Injectable()
export class HtmlScraperAdapter implements SourceAdapter {
  readonly type = SourceType.HTML_SCRAPE;
  private readonly logger = new Logger(HtmlScraperAdapter.name);

  constructor(
    private readonly fetcherFactory: HttpFetcherFactory,
    private readonly rateLimiter: DomainRateLimiterService,
  ) {}

  async fetchCandidates(source: Source, _cursor: unknown | null): Promise<FetchResult> {
    const config = source.config as unknown as HtmlScraperSourceConfig;
    if (!config?.listingUrl || !config.itemSelector) {
      throw new Error(`Source ${source.institutionCode}: config de scraping incompleta`);
    }

    const fetcher = this.fetcherFactory.get(source.fetchMethod ?? FetchMethod.HTTP_SIMPLE);
    const items: RawCandidate[] = [];
    const maxPages = config.pagination?.maxPagesPerRun ?? 1;

    let pageUrl: string | null = config.listingUrl;
    let pagesFetched = 0;

    while (pageUrl && pagesFetched < maxPages) {
      const html = await fetcher.fetchText(pageUrl);
      const $ = cheerio.load(html);

      $(config.itemSelector).each((_i, el) => {
        const row = $(el);
        const title = row.find(config.titleSelector).first().text().trim();
        const dateText = row.find(config.dateSelector).first().text().trim();
        const relativeLink = row.find(config.linkSelector).first().attr('href');
        if (!title || !relativeLink) return;

        const url = new URL(relativeLink, source.baseUrl).toString();
        const docType = config.docTypeSelector
          ? row.find(config.docTypeSelector).first().text().trim()
          : null;
        const publishedAt = parseFlexibleDate(dateText);
        const imageUrl = this.extractRowImageUrl(row, config, source.baseUrl);

        items.push({
          externalId: url,
          url,
          title,
          excerpt: docType,
          publishedAt,
          // rawText se completa despues de descargar el documento (puede
          // ser PDF); aqui solo dejamos un placeholder minimo verificable
          // por si la descarga del documento falla mas adelante.
          rawText: title,
          contentHash: computeContentHash(title, url),
          imageUrl,
        });
      });

      pagesFetched += 1;
      if (config.pagination) {
        const nextHref = $(config.pagination.nextPageSelector).first().attr('href');
        pageUrl = nextHref ? new URL(nextHref, source.baseUrl).toString() : null;
      } else {
        pageUrl = null;
      }
    }

    if (items.length === 0) {
      throw new Error(
        `Source ${source.institutionCode}: 0 items encontrados con itemSelector "${config.itemSelector}" -- ` +
          `posible cambio de estructura del sitio, revisar selectores manualmente antes de reintentar`,
      );
    }

    // Ventana de recencia primero, tope de conteo despues -- mismo orden
    // que RssAdapter. Source.maxAgeDays/maxItemsPerRun (configurables
    // desde el panel) tienen prioridad sobre sus equivalentes en config.
    const maxAgeDays = source.maxAgeDays ?? config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const withinWindow = items.filter((item) => item.publishedAt >= cutoffDate);

    // Tope duro antes de gastar red/tiempo descargando documentos (PDFs)
    // de items que de todas formas no se van a procesar. Los listados de
    // este tipo de sitio son reverso-cronologicos, asi que quedarse con
    // los primeros N conserva lo mas reciente.
    const maxItems = source.maxItemsPerRun ?? config.maxItemsPerRun ?? DEFAULT_MAX_ITEMS_PER_RUN;
    const bounded = withinWindow.slice(0, maxItems);
    if (items.length > bounded.length) {
      this.logger.warn(
        `Fuente ${source.institutionCode}: ${items.length} items encontrados, ${withinWindow.length} dentro de ` +
          `la ventana de ${maxAgeDays} dias, acotado a ${bounded.length} (maxItemsPerRun=${maxItems}) -- ` +
          `el resto se ignora esta corrida.`,
      );
    }

    await this.enrichWithDocumentText(bounded, fetcher, source.institutionCode);
    await this.enrichWithDetailImage(bounded, fetcher, config, source.institutionCode);

    return { items: bounded, nextCursor: null };
  }

  /// Si el enlace de un item apunta a un PDF, descarga y extrae su texto
  /// real como contenido del articulo. Si no es PDF (p.ej. una pagina
  /// HTML de detalle), se deja rawText=title -- no se inventa contenido;
  /// una calibracion futura puede anadir un selector de detalle HTML por
  /// fuente si se necesita mas cuerpo de texto.
  private async enrichWithDocumentText(
    items: RawCandidate[],
    fetcher: HttpFetcher,
    institutionCode: string,
  ): Promise<void> {
    for (const item of items) {
      if (!item.url.toLowerCase().endsWith('.pdf')) continue;
      try {
        const pdfText = await this.fetchPdfText(item.url);
        if (pdfText.trim().length > 0) {
          item.rawText = pdfText.trim();
          item.contentHash = computeContentHash(item.title, item.rawText);
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo extraer texto del PDF ${item.url} (fuente ${institutionCode}): ${(err as Error).message}. ` +
            `Se conserva solo el titulo como contenido -- no se fabrica texto de relleno.`,
        );
      }
    }
  }

  /// Si extractRowImageUrl no encontro nada en el listado (ej. ADRES, que
  /// pone la imagen como CSS background-image inline en vez de <img src>
  /// -- ver comentario del seed de esa fuente), intenta en orden: 1)
  /// <meta property="og:image"> de la pagina de detalle real, 2) si la
  /// fuente tiene detailImageSelector configurado (calibrado a mano
  /// contra HTML real, ver su comentario), la primera <img> dentro de
  /// ese selector. Ambos sobre el mismo fetch de la pagina -- no se
  /// duplica la descarga. Se salta los PDF (no son HTML). Nunca falla la
  /// corrida si la pagina no carga o no trae nada: se deja imageUrl=null.
  private async enrichWithDetailImage(
    items: RawCandidate[],
    fetcher: HttpFetcher,
    config: HtmlScraperSourceConfig,
    institutionCode: string,
  ): Promise<void> {
    for (const item of items) {
      if (item.imageUrl || item.url.toLowerCase().endsWith('.pdf')) continue;
      try {
        const html = await fetcher.fetchText(item.url);
        item.imageUrl = extractDetailPageImage(html, item.url, config.detailImageSelector);
      } catch (err) {
        this.logger.warn(
          `No se pudo obtener imagen de detalle de ${item.url} (fuente ${institutionCode}): ${(err as Error).message}. ` +
            `Se deja sin imagen -- no se fabrica ninguna.`,
        );
      }
    }
  }

  private extractRowImageUrl(
    row: cheerio.Cheerio<any>,
    config: HtmlScraperSourceConfig,
    baseUrl: string,
  ): string | null {
    if (!config.imageSelector) return null;
    const src = row.find(config.imageSelector).first().attr('src');
    if (!src) return null;
    try {
      return new URL(src, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private async fetchPdfText(url: string): Promise<string> {
    // pdf-parse necesita el binario crudo, no texto, por eso se usa `got`
    // directamente en vez de HttpFetcher.fetchText -- pero se respeta el
    // mismo rate-limit por dominio que el resto de los fetchers.
    await this.rateLimiter.consume(url);
    const response = await got.get(url, {
      responseType: 'buffer',
      timeout: { request: 30_000 },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    const parsed = await pdfParse(response.body as Buffer);
    return parsed.text;
  }
}

/// Bug real encontrado 2026-07-16 al calibrar ADRES: `new Date("d/m/aaaa")`
/// de JS asume MM/DD/AAAA (formato US), no DD/MM/AAAA (formato usado por
/// todos los sitios de gobierno colombianos vistos hasta ahora). Con
/// dia<=12 esto NO lanza error, produce una fecha VALIDA pero equivocada
/// en silencio (ej. "3/07/2026" -- 3 de julio -- se leia como 7 de marzo).
/// Por eso el formato DD/MM/AAAA se intenta explicitamente antes de caer
/// al parser ambiguo nativo.
function parseFlexibleDate(text: string): Date {
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }
  const dmyMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(Number(dmyMatch[3]), month - 1, day));
    }
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
