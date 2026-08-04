import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import { Source, SourceType, FetchMethod } from '@prisma/client';
import { SourceAdapter } from '../interfaces/source-adapter.interface';
import { FetchResult, RawCandidate } from '../interfaces/raw-candidate.interface';
import { computeContentHash } from '../../common/content-hash.util';
import { HttpFetcherFactory } from '../fetchers/http-fetcher.factory';
import { extractFirstImageUrl, extractFirstImageLinkUrl, extractOgImage } from './image-extraction.util';
import { HttpFetcher } from '../fetchers/http-fetcher.interface';

/// Config esperada en Source.config para type=RSS:
/// { "feedUrls": string[], "maxItemsPerFeed"?: number, "maxAgeDays"?: number }
/// maxItemsPerFeed aqui es solo el default de esta fuente si nadie lo
/// configura desde el panel -- Source.maxItemsPerRun (columna propia,
/// editable en la pestaña Fuentes) tiene prioridad cuando esta presente.
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

/// Bajado de 30 a 3 el 2026-07-17 (pedido explicito del usuario): el
/// fetch inicial solo conserva las 3 mas recientes por fuente -- ver
/// IngestionDispatcher.fetchMore() para el flujo de "buscar otras 3" que
/// un validador puede disparar si ninguna de las primeras 3 le sirve.
const DEFAULT_MAX_ITEMS_PER_FEED = 3;
/// Subido de 3 a 7 el 2026-08-04 (pedido explicito del usuario): con 3
/// dias, la mayoria de las fuentes (PAHO, CDC, DSSA, MINCIENCIAS)
/// quedaban en 0 items casi toda corrida por publicar con una cadencia de
/// varios dias, no diaria -- ver diagnostico real contra los feeds en
/// vivo (PAHO quedaba justo 1 dia afuera de la ventana). Sigue siendo
/// configurable por fuente (Source.maxAgeDays) si alguna institucion
/// necesita una ventana distinta.
const DEFAULT_MAX_AGE_DAYS = 7;

@Injectable()
export class RssAdapter implements SourceAdapter {
  readonly type = SourceType.RSS;
  private readonly logger = new Logger(RssAdapter.name);
  // content:encoded es donde WordPress embebe el <img> del cuerpo del
  // post -- rss-parser no lo trae por defecto (solo <description>),
  // hay que pedirlo explicitamente via customFields. media:content es el
  // namespace Media RSS (xmlns:media="http://search.yahoo.com/mrss/") que
  // usa CDC para la imagen del item -- caso real encontrado 2026-07-17,
  // rss-parser tampoco lo trae por defecto. keepArray:true porque un item
  // puede traer mas de un <media:content> (distintos tamanos).
  private readonly parser = new Parser({
    timeout: 20_000,
    customFields: { item: ['content:encoded', ['media:content', 'mediaContent', { keepArray: true }]] },
  });

  constructor(private readonly fetcherFactory: HttpFetcherFactory) {}

  async fetchCandidates(source: Source, _cursor: unknown | null): Promise<FetchResult> {
    const config = source.config as unknown as RssSourceConfig;
    if (!config?.feedUrls?.length) {
      throw new Error(`Source ${source.institutionCode}: config.feedUrls vacio o ausente`);
    }

    // Source.maxItemsPerRun (configurable desde el panel, pestaña Fuentes)
    // tiene prioridad sobre config.maxItemsPerFeed -- ver su comentario en
    // el schema para el porque de unificar esto en un solo campo.
    const maxItemsPerFeed = source.maxItemsPerRun ?? config.maxItemsPerFeed ?? DEFAULT_MAX_ITEMS_PER_FEED;
    // Source.maxAgeDays (configurable desde el panel) tiene prioridad
    // sobre config.maxAgeDays.
    const maxAgeDays = source.maxAgeDays ?? config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
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

        // Fallback a og:image SOLO sobre lo que ya paso el recorte --
        // nunca sobre el feed completo, para no gastar un fetch extra por
        // item que de todas formas se iba a descartar.
        await this.enrichWithOgImage(bounded, fetcher, source.institutionCode);

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

  /// Si el feed no trajo imagen (content:encoded/description/enclosure
  /// vacios), va a buscar el <meta property="og:image"> de la pagina real
  /// del articulo -- caso real encontrado 2026-07-17: el feed de WHO no
  /// trae imagen en el XML, pero la pagina si la expone via og:image.
  /// Solo corre sobre items ya acotados (ver llamador) y nunca falla la
  /// corrida si la pagina no carga: se deja imageUrl=null, no se fabrica.
  private async enrichWithOgImage(items: RawCandidate[], fetcher: HttpFetcher, institutionCode: string): Promise<void> {
    for (const item of items) {
      if (item.imageUrl) continue;
      try {
        const html = await fetcher.fetchText(item.url);
        item.imageUrl = extractOgImage(html, item.url);
      } catch (err) {
        this.logger.warn(
          `No se pudo obtener og:image de ${item.url} (fuente ${institutionCode}): ${(err as Error).message}. ` +
            `Se deja sin imagen -- no se fabrica ninguna.`,
        );
      }
    }
  }

  /// Orden de prioridad: 1) <enclosure> si es de tipo imagen (soporte
  /// nativo de rss-parser), 2) <media:content> tipo imagen (namespace
  /// Media RSS -- caso CDC), 3) primer <img> dentro de content:encoded
  /// (WordPress), 4) primer <img> dentro de la descripcion/contenido
  /// generico, 5) primer <a href> que apunte a un archivo de imagen real
  /// dentro de content:encoded o de la descripcion (caso SharePoint/Salud
  /// Capital -- ver extractFirstImageLinkUrl). null si nada de esto trae
  /// una imagen real -- nunca se inventa ni se usa un placeholder.
  private extractImageUrl(
    entry: Parser.Item & {
      'content:encoded'?: string;
      mediaContent?: Array<{ $?: { url?: string; type?: string } }>;
    },
    itemUrl: string,
  ): string | null {
    if (entry.enclosure?.url && entry.enclosure.type?.startsWith('image/')) {
      return entry.enclosure.url;
    }

    const mediaImage = entry.mediaContent?.find((m) => m.$?.url && (m.$.type?.startsWith('image/') ?? true));
    if (mediaImage?.$?.url) return mediaImage.$.url;

    const fromEncodedContent = extractFirstImageUrl(entry['content:encoded'], itemUrl);
    if (fromEncodedContent) return fromEncodedContent;

    const fromContent = extractFirstImageUrl(entry.content, itemUrl);
    if (fromContent) return fromContent;

    const fromEncodedLink = extractFirstImageLinkUrl(entry['content:encoded'], itemUrl);
    if (fromEncodedLink) return fromEncodedLink;

    return extractFirstImageLinkUrl(entry.content, itemUrl);
  }
}
