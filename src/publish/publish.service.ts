import { Injectable } from '@nestjs/common';
import { ArticleState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';

/// Decision 2026-07-16: la publicacion ya no empuja hacia un WordPress
/// externo (ver [[ecofarma-diario-salud-stack]] en memoria) -- el destino
/// final de un articulo VALIDADO es nuestra propia API publica de solo
/// lectura (GET /articles, ArticlesController). Este servicio se reduce a
/// un unico paso: la transicion de estado, que ArticleStateMachineService
/// ya protege con el CHECK "publish_requires_validation" de Postgres.
@Injectable()
export class PublishService {
  constructor(private readonly prisma: PrismaService, private readonly stateMachine: ArticleStateMachineService) {}

  /// Articulos validados por un humano, esperando el paso final de
  /// publicacion.
  getPublishQueue() {
    return this.prisma.article.findMany({
      where: { state: ArticleState.VALIDADO },
      orderBy: { validatedAt: 'asc' },
      include: { source: true },
    });
  }

  async publish(articleId: string, actorId: string) {
    return this.stateMachine.publish(articleId, actorId);
  }
}
