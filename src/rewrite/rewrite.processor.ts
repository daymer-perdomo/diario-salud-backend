import { Inject, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';

export interface RewriteArticleJobData {
  articleId: string;
  /// Presente solo en el reintento automatico disparado por
  /// GroundingModule tras un fallo de fidelidad -- se inyecta en el
  /// prompt para que el modelo evite repetir el mismo error.
  groundingFeedback?: string;
}

@Processor(QUEUE_NAMES.REWRITE)
export class RewriteProcessor extends WorkerHost {
  private readonly logger = new Logger(RewriteProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
    @InjectQueue(QUEUE_NAMES.GROUND) private readonly groundQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<RewriteArticleJobData>): Promise<void> {
    const article = await this.articlesService.findById(job.data.articleId);

    const originalContent = job.data.groundingFeedback
      ? `${article.originalContent}\n\n[NOTA PARA EL MODELO -- no forma parte de la fuente, es retroalimentacion de un intento anterior]: ${job.data.groundingFeedback}`
      : article.originalContent;

    const rewriteResult = await this.llm.rewrite({
      originalTitle: article.originalTitle,
      originalContent,
      sourceInstitution: article.sourceInstitution,
    });

    await this.stateMachine.markRewritten(article.id, {
      rewrittenTitle: rewriteResult.rewrittenTitle,
      rewrittenSummary: rewriteResult.rewrittenSummary,
      rewrittenContent: rewriteResult.rewrittenContent,
      rewrittenKeyPoints: rewriteResult.keyPoints,
      rewrittenWhyItMatters: rewriteResult.whyItMatters,
      rewriteModel: 'gemini',
    });

    await this.groundQueue.add(
      JOB_NAMES.GROUND_ARTICLE,
      { articleId: article.id, claims: rewriteResult.claims },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RewriteArticleJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'REWRITE', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de reescritura: ${err}`));
  }
}
