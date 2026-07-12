import { Inject, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';

interface ScoreArticleJobData {
  articleId: string;
}

@Processor(QUEUE_NAMES.SCORE)
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
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
    });

    await this.rewriteQueue.add(
      JOB_NAMES.REWRITE_ARTICLE,
      { articleId: article.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScoreArticleJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'SCORING', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de scoring: ${err}`));
  }
}
