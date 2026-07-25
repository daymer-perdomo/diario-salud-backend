import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ArticleState, ValidationDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticlesService } from '../articles/articles.service';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { withDefaultImage } from '../common/default-article-image.util';

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
  ) {}

  /// Cola de revision: articulos ya listos para que un humano decida.
  async getReviewQueue() {
    const articles = await this.prisma.article.findMany({
      where: { state: ArticleState.EN_VALIDACION },
      orderBy: { createdAt: 'asc' },
      include: { source: true },
    });
    return articles.map(withDefaultImage);
  }

  /// Cola de triage: articulos que el pipeline automatico no pudo
  /// resolver por si solo (fallo de fidelidad tras el reintento, fallo
  /// de cumplimiento, o error tecnico) y requieren decision humana:
  /// regenerar, editar manualmente, o rechazar.
  async getTriageQueue() {
    const articles = await this.prisma.article.findMany({
      where: { state: { in: [ArticleState.GROUNDING_FALLIDO, ArticleState.CUMPLIMIENTO_FALLIDO, ArticleState.ERROR] } },
      orderBy: { createdAt: 'asc' },
      include: { source: true },
    });
    return articles.map(withDefaultImage);
  }

  /// Vista unificada para el panel (2026-07-17, pedido explicito del
  /// usuario): union de TODOS los estados relevantes para un humano --
  /// revision, triage, validado, rechazado y publicado -- en una sola
  /// lista para la tabla del dashboard con filtro de Estado en el
  /// sidebar. Deliberadamente NO incluye los estados puramente
  /// automaticos previos a la reescritura (RECOLECTADO/DESCARTADO/
  /// EVALUADO/REESCRITO): esos articulos todavia no tienen
  /// rewrittenTitle/rewrittenContent, no encajan en las columnas de
  /// esta tabla (pensada para revisar reescrituras, no el crudo
  /// recolectado).
  async getAllForStaff() {
    const articles = await this.prisma.article.findMany({
      where: {
        state: {
          in: [
            ArticleState.EN_VALIDACION,
            ArticleState.GROUNDING_FALLIDO,
            ArticleState.CUMPLIMIENTO_FALLIDO,
            ArticleState.ERROR,
            ArticleState.VALIDADO,
            ArticleState.RECHAZADO,
            ArticleState.PUBLICADO,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { source: true },
    });
    return articles.map(withDefaultImage);
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
      editedKeyPoints?: string[];
      editedWhyItMatters?: string;
    },
  ) {
    return this.stateMachine.validate(articleId, { validatorId, ...params });
  }

  /// Boton "Regenerar" del panel (brief seccion 10.2): vuelve a encolar
  /// la reescritura para un articulo en triage O en la cola de
  /// validacion normal (un validador que no esta conforme con la
  /// reescritura puede pedir una nueva sin rechazar el articulo). No
  /// cambia el estado aqui -- markRewritten (dentro de RewriteProcessor)
  /// es quien lo hace, y solo acepta la transicion desde GROUNDING_FALLIDO
  /// / CUMPLIMIENTO_FALLIDO / EVALUADO / EN_VALIDACION (ver assertState).
  async regenerate(articleId: string) {
    const article = await this.articlesService.findById(articleId);
    // ERROR se deja fuera a proposito: puede haber fallado en cualquier
    // etapa (no necesariamente reescritura) y no tiene un "siguiente
    // paso" unico -- requiere que un humano revise errorStage/
    // lastErrorMessage y decida, no un boton generico de regenerar.
    const regenerableStates: ArticleState[] = [
      ArticleState.GROUNDING_FALLIDO,
      ArticleState.CUMPLIMIENTO_FALLIDO,
      ArticleState.EN_VALIDACION,
    ];
    if (!regenerableStates.includes(article.state)) {
      throw new BadRequestException(
        `Article ${articleId} esta en ${article.state}, solo se puede regenerar desde GROUNDING_FALLIDO, ` +
          `CUMPLIMIENTO_FALLIDO o EN_VALIDACION`,
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
