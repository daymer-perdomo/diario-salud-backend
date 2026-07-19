import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';

interface ScoreArticleJobData {
  articleId: string;
}

/// Deja el articulo en EVALUADO y se detiene ahi -- ya NO encola a
/// rewrite. Desde el incidente de agotamiento de credito (2026-07-12,
/// ver rss.adapter.ts), decidir cuales EVALUADO avanzan a las etapas
/// caras (rewrite/grounding/compliance, todas con llamadas a LLM) es
/// responsabilidad de RewriteSelectionService, que solo deja pasar los
/// mejores DAILY_REWRITE_LIMIT por corrida. Antes, cualquier articulo
/// marcado isRelevant=true se encolaba de inmediato sin tope alguno.
@Processor(QUEUE_NAMES.SCORE)
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {
    super();
  }

  async process(job: Job<ScoreArticleJobData>): Promise<void> {
    const article = await this.articlesService.findById(job.data.articleId);

    const result = await this.llm.scoreRelevanceAndRisk({
      originalTitle: article.originalTitle,
      originalContent: article.originalContent,
      sourceInstitution: article.sourceInstitution,
    });

    if (!result.isRelevant) {
      await this.stateMachine.markDiscarded(article.id, result.relevanceReason);
      this.logger.log(`Descartado por IA (relevancia): ${article.id}`);
      return;
    }

    await this.stateMachine.markEvaluated(article.id, {
      relevanceScore: result.relevanceScore,
      relevanceReason: result.relevanceReason,
      riskLevel: result.riskLevel!,
      riskReason: result.riskReason,
      contentType: result.contentType!,
    });
    this.logger.log(`Evaluado, en espera de seleccion diaria: ${article.id}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScoreArticleJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'SCORING', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de scoring: ${err}`));
  }
}
