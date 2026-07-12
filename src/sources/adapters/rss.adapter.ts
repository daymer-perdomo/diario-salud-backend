import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import { Source, SourceType, FetchMethod } from '@prisma/client';
import { SourceAdapter } from '../interfaces/source-adapter.interface';
import { FetchResult, RawCandidate } from '../interfaces/raw-candidate.interface';
import { computeContentHash } from '../../common/content-hash.util';
import { HttpFetcherFactory } from '../fetchers/http-fetcher.factory';
import { extractFirstImageUrl } from './image-extraction.util';

/// Config esperada en Source.config para type=RSS:
/// { "feedUrls": string[], "maxItemsPerFeed"?: number, "maxAgeDays"?: number }
/// Varias fuentes ya confirmadas: Minciencias, DSSA, Salud Capital
/// (listfeed.aspx de SharePoint), WHO, PAHO, CDC (subdominios
/// tools.cdc.gov / wwwnc.cdc.gov -- www.cdc.gov bloquea fetch directo).
///
/// INCIDENTE REAL (2026-07-12): sin limite, el feed de avisos de viaje de
/// CDC (wwwnc.cdc.gov/travel/rss/notices.xml) devolvio ~1800 items
/// historicos en la primera corrida -- todos "nuevos" por no existir aun
/// en la DB -- y se encolaron de una sola vez a scoring con IA, agotando
/// el saldo de la cuenta de Anthropic en minutos. A diferencia de
/// HtmlScraperAdapter (que ya limitaba por maxPagesPerRun), este adapter
/// no tenia ningun tope. maxItemsPerFeed + maxAgeDays son la misma idea
/// de "acotar por corrida" aplicada a RSS.
interface RssSourceConfig {
  feedUrls: string[];
  maxItemsPerFeed?: number;
  maxAgeDays?: number;
}

const DEFAULT_MAX_ITEMS_PER_FEED = 30;
const DEFAULT_MAX_AGE_DAYS = 30;

@Injectable()
export class RssAdapter implements SourceAdapter {
  readonly type = SourceType.RSS;
  private readonly logger = new Logger(RssAdapter.name);
  // content:encoded es donde WordPress embebe el <img> del cuerpo del
  // post -- rss-parser no lo trae por defecto (solo <description>),
  // hay que pedirlo explicitamente via customFields.
  private readonly parser = new Parser({
    timeout: 20_000,
    customFields: { item: ['content:encoded'] },
  });

  constructor(private readonly fetcherFactory: HttpFetcherFactory) {}

  async fetchCandidates(source: Source, _cursor: unknown | null): Promise<FetchResult> {
    const config = source.config as unknown as RssSourceConfig;
    if (!config?.feedUrls?.length) {
      throw new Error(`Source ${source.institutionCode}: config.feedUrls vacio o ausente`);
    }

    const maxItemsPerFeed = config.maxItemsPerFeed ?? DEFAULT_MAX_ITEMS_PER_FEED;
    const maxAgeDays = config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const fetcher = this.fetcherFactory.get(source.fetchMethod ?? FetchMethod.HTTP_SIMPLE);
    const items: RawCandidate[] = [];
    const errors: string[] = [];

    for (const feedUrl of config.feedUrls) {
      try {
        const xml = await fetcher.fetchText(feedUrl);
        const feed = await this.parser.parseString(xml);

        const feedCandidates: RawCandidate[] = [];
        for (const entry of feed.items ?? []) {
          const title = entry.title?.trim() ?? '';
          const rawText = (entry.contentSnippet || entry.content || entry.summary || '').trim();
          const url = entry.link?.trim();
          if (!title || !url) continue;

          const publishedAt = entry.isoDate ? new Date(entry.isoDate) : new Date();
          const imageUrl = this.extractImageUrl(entry, url);

          feedCandidates.push({
            externalId: entry.guid ?? url,
            url,
            title,
            excerpt: entry.contentSnippet?.trim() ?? null,
            publishedAt,
            rawText: rawText || title,
            contentHash: computeContentHash(title, rawText || title),
            imageUrl,
          });
        }

        // Ventana de recencia + tope duro, siempre conservando lo mas
        // nuevo primero -- nunca se procesa un feed completo sin limite.
        const withinWindow = feedCandidates.filter((c) => c.publishedAt >= cutoffDate);
        const bounded = withinWindow
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
          .slice(0, maxItemsPerFeed);

        if (feedCandidates.length > bounded.length) {
          this.logger.warn(
            `Feed ${feedUrl} (${source.institutionCode}): ${feedCandidates.length} items en el XML, ` +
              `acotado a ${bounded.length} (maxAgeDays=${maxAgeDays}, maxItemsPerFeed=${maxItemsPerFeed}) -- ` +
              `el resto se ignora esta corrida, no se pierden permanentemente si vuelven a aparecer dentro de la ventana`,
          );
        }

        items.push(...bounded);
      } catch (err) {
        const message = `feed ${feedUrl}: ${(err as Error).message}`;
        this.logger.error(`Fallo al leer ${message} (fuente ${source.institutionCode})`);
        errors.push(message);
        // No se agrega contenido de relleno por un feed caido; si TODOS
        // los feeds de la fuente fallan (ver abajo) se propaga el error
        // para que IngestionModule lo marque explicitamente como fallo,
        // en vez de reportar "cero items nuevos" (que se veria igual a un
        // exito legitimo sin novedades).
      }
    }

    if (errors.length === config.feedUrls.length) {
      throw new Error(`Todos los feeds de ${source.institutionCode} fallaron: ${errors.join(' | ')}`);
    }

    return { items, nextCursor: null };
  }

  /// Orden de prioridad: 1) <enclosure> si es de tipo imagen (soporte
  /// nativo de rss-parser), 2) primer <img> dentro de content:encoded
  /// (WordPress), 3) primer <img> dentro de la descripcion/contenido
  /// generico. null si nada de esto trae una imagen real -- nunca se
  /// inventa ni se usa un placeholder.
  private extractImageUrl(entry: Parser.Item & { 'content:encoded'?: string }, itemUrl: string): string | null {
    if (entry.enclosure?.url && entry.enclosure.type?.startsWith('image/')) {
      return entry.enclosure.url;
    }

    const fromEncodedContent = extractFirstImageUrl(entry['content:encoded'], itemUrl);
    if (fromEncodedContent) return fromEncodedContent;

    return extractFirstImageUrl(entry.content, itemUrl);
  }
}
