import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ArticleState, ValidationDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticlesService } from '../articles/articles.service';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
  ) {}

  /// Cola de revision: articulos ya listos para que un humano decida.
  getReviewQueue() {
    return this.prisma.article.findMany({
      where: { state: ArticleState.EN_VALIDACION },
      orderBy: { createdAt: 'asc' },
      include: { source: true },
    });
  }

  /// Cola de triage: articulos que el pipeline automatico no pudo
  /// resolver por si solo (fallo de fidelidad tras el reintento, fallo
  /// de cumplimiento, o error tecnico) y requieren decision humana:
  /// regenerar, editar manualmente, o rechazar.
  getTriageQueue() {
    return this.prisma.article.findMany({
      where: { state: { in: [ArticleState.GROUNDING_FALLIDO, ArticleState.CUMPLIMIENTO_FALLIDO, ArticleState.ERROR] } },
      orderBy: { createdAt: 'asc' },
      include: { source: true },
    });
  }

  getDetail(articleId: string) {
    return this.articlesService.findById(articleId);
  }

  async validate(
    articleId: string,
    validatorId: string,
    params: {
      decision: ValidationDecision;
      notes?: string;
      editedTitle?: string;
      editedSummary?: string;
      editedContent?: string;
    },
  ) {
    return this.stateMachine.validate(articleId, { validatorId, ...params });
  }

  /// Boton "Regenerar" del panel (brief seccion 10.2): vuelve a encolar
  /// la reescritura para un articulo en triage. No cambia el estado
  /// aqui -- markRewritten (dentro de RewriteProcessor) es quien lo
  /// hace, y solo acepta la transicion desde GROUNDING_FALLIDO /
  /// CUMPLIMIENTO_FALLIDO / EVALUADO (ver assertState).
  async regenerate(articleId: string) {
    const article = await this.articlesService.findById(articleId);
    // ERROR se deja fuera a proposito: puede haber fallado en cualquier
    // etapa (no necesariamente reescritura) y no tiene un "siguiente
    // paso" unico -- requiere que un humano revise errorStage/
    // lastErrorMessage y decida, no un boton generico de regenerar.
    const regenerableStates: ArticleState[] = [ArticleState.GROUNDING_FALLIDO, ArticleState.CUMPLIMIENTO_FALLIDO];
    if (!regenerableStates.includes(article.state)) {
      throw new BadRequestException(
        `Article ${articleId} esta en ${article.state}, solo se puede regenerar desde GROUNDING_FALLIDO o CUMPLIMIENTO_FALLIDO`,
      );
    }

    await this.rewriteQueue.add(
      JOB_NAMES.REWRITE_ARTICLE,
      { articleId },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
    );
    return { queued: true };
  }
}
