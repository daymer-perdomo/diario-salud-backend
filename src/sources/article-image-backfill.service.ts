import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ArticleState, SourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HttpFetcherFactory } from './fetchers/http-fetcher.factory';
import { extractDetailPageImage } from './adapters/image-extraction.util';

/// Estados en los que un articulo es visible para un humano (panel/API
/// publica) -- mismo criterio que ValidationService.getAllForStaff().
/// RECOLECTADO/DESCARTADO/EVALUADO/REESCRITO nunca se muestran con
/// imagen, no vale la pena gastar un fetch en ellos.
const VISIBLE_STATES: ArticleState[] = [
  ArticleState.EN_VALIDACION,
  ArticleState.GROUNDING_FALLIDO,
  ArticleState.CUMPLIMIENTO_FALLIDO,
  ArticleState.ERROR,
  ArticleState.VALIDADO,
  ArticleState.RECHAZADO,
  ArticleState.PUBLICADO,
];

/// Tope de reintentos por articulo -- sin esto, uno que genuinamente no
/// tiene imagen en ninguna parte (verificado en vivo: Minciencias, ni el
/// feed ni og:image de la pagina traen nada) se reintentaria en cada
/// corrida del cron para siempre.
const MAX_BACKFILL_ATTEMPTS = 5;
/// Cuantos articulos procesa cada corrida del cron -- deliberadamente
/// chico, este es un job de mantenimiento de fondo, no una carrera.
const BATCH_SIZE = 10;

/// Pedido explicito del usuario 2026-07-17, tras encontrar varios bugs
/// reales de "el articulo tiene imagen en la fuente pero no la
/// obtuvimos" (Salud Capital, CDC, PAHO -- ver comentarios de RssAdapter/
/// HtmlScraperAdapter/DomainRateLimiterService): en vez de un agente de
/// IA para "encontrar la imagen" (gasto de LLM real por articulo para
/// algo que ya sabemos resolver de forma deterministica, y que ademas
/// choca con el principio del proyecto de minimizar costo de IA), este
/// es un job periodico SIN IA que reintenta la MISMA cadena de
/// extraccion (og:image / selector de detalle calibrado por fuente,
/// ver extractDetailPageImage) sobre articulos que quedaron con
/// imageUrl null -- cubre exactamente los casos reales encontrados hoy
/// (rate-limit transitorio, fetch que fallo una vez), sin inventar ni
/// asumir ninguna imagen que la fuente no provea.
@Injectable()
export class ArticleImageBackfillService {
  private readonly logger = new Logger(ArticleImageBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcherFactory: HttpFetcherFactory,
  ) {}

  @Cron('*/15 * * * *')
  async retryMissingImages(): Promise<void> {
    const candidates = await this.prisma.article.findMany({
      where: {
        imageUrl: null,
        state: { in: VISIBLE_STATES },
        imageBackfillAttempts: { lt: MAX_BACKFILL_ATTEMPTS },
        source: { type: { not: SourceType.OPEN_DATA_API } },
      },
      include: { source: true },
      orderBy: { createdAt: 'desc' },
      take: BATCH_SIZE,
    });

    if (candidates.length === 0) return;
    this.logger.log(`Reintentando imagen de ${candidates.length} articulo(s)`);

    for (const article of candidates) {
      if (article.sourceUrl.toLowerCase().endsWith('.pdf')) {
        // No es HTML -- no hay nada que extraer, pero igual cuenta el
        // intento para no volver a elegirlo cada corrida.
        await this.prisma.article.update({
          where: { id: article.id },
          data: { imageBackfillAttempts: { increment: 1 } },
        });
        continue;
      }

      try {
        const fetcher = this.fetcherFactory.get(article.source.fetchMethod);
        const html = await fetcher.fetchText(article.sourceUrl);
        const detailSelector =
          article.source.type === SourceType.HTML_SCRAPE
            ? ((article.source.config as { detailImageSelector?: string } | null)?.detailImageSelector ?? null)
            : null;
        const imageUrl = extractDetailPageImage(html, article.sourceUrl, detailSelector);

        await this.prisma.article.update({
          where: { id: article.id },
          data: { imageBackfillAttempts: { increment: 1 }, ...(imageUrl ? { imageUrl } : {}) },
        });

        if (imageUrl) {
          this.logger.log(`Imagen recuperada para articulo ${article.id} (${article.source.institutionCode})`);
        }
      } catch (err) {
        await this.prisma.article.update({
          where: { id: article.id },
          data: { imageBackfillAttempts: { increment: 1 } },
        });
        this.logger.warn(
          `Reintento de imagen fallo para articulo ${article.id} (${article.source.institutionCode}): ${(err as Error).message}`,
        );
      }
    }
  }
}
