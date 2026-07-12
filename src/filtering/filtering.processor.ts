import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';
import { isObviousJobPostingOrProcurement } from './keyword-prefilter';

interface FilterArticleJobData {
  articleId: string;
}

@Processor(QUEUE_NAMES.FILTER)
export class FilteringProcessor extends WorkerHost {
  private readonly logger = new Logger(FilteringProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @InjectQueue(QUEUE_NAMES.SCORE) private readonly scoreQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<FilterArticleJobData>): Promise<void> {
    const article = await this.articlesService.findById(job.data.articleId);

    if (isObviousJobPostingOrProcurement(article.originalTitle, article.originalContent)) {
      await this.stateMachine.markDiscarded(
        article.id,
        'Pre-filtro por palabra clave: oferta de empleo o licitacion/contratacion publica',
      );
      this.logger.log(`Descartado por pre-filtro: ${article.id}`);
      return;
    }

    await this.scoreQueue.add(
      JOB_NAMES.SCORE_ARTICLE,
      { articleId: article.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
    );
  }

  /// Sin este handler, un fallo que agota reintentos dejaria el Article
  /// atascado en su estado previo, invisible para cualquier humano.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<FilterArticleJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'FILTERING', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de filtrado: ${err}`));
  }
}
