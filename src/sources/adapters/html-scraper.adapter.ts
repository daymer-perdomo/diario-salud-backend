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
  pagination?: {
    nextPageSelector: string;
    maxPagesPerRun: number;
  };
}

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

    await this.enrichWithDocumentText(items, fetcher, source.institutionCode);

    return { items, nextCursor: null };
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

function parseFlexibleDate(text: string): Date {
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
