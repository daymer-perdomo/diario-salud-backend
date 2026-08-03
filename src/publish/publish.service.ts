import { Injectable, Logger } from '@nestjs/common';
import { ArticleState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { withDefaultImage } from '../common/default-article-image.util';
import { WordpressPublishService } from '../wordpress/wordpress-publish.service';

/// El destino final de un articulo VALIDADO es nuestra propia API publica
/// de solo lectura (GET /articles, ArticlesController) -- eso nunca cambia,
/// PublishService.publish() se reduce a la transicion de estado, que
/// ArticleStateMachineService ya protege con el CHECK
/// "publish_requires_validation" de Postgres. El espejo hacia el WordPress
/// de EcoFarma (WordpressPublishService) es un paso adicional, best-effort:
/// se dispara aqui para no esperar hasta el proximo intervalo programado,
/// pero un fallo ahi JAMAS debe impedir que /publish/:id/publish responda
/// 200 -- el intervalo (o POST /wordpress/sync-now) reintenta despues.
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: ArticleStateMachineService,
    private readonly wordpressPublish: WordpressPublishService,
  ) {}

  /// Articulos validados por un humano, esperando el paso final de
  /// publicacion.
  async getPublishQueue() {
    const articles = await this.prisma.article.findMany({
      where: { state: ArticleState.VALIDADO },
      orderBy: { validatedAt: 'asc' },
      include: { source: true },
    });
    return articles.map(withDefaultImage);
  }

  async publish(articleId: string, actorId: string) {
    const article = await this.stateMachine.publish(articleId, actorId);
    this.wordpressPublish
      .syncNow()
      .catch((err) => this.logger.warn(`Espejo a WordPress tras publicar ${articleId} fallo: ${(err as Error).message}`));
    return article;
  }
}
