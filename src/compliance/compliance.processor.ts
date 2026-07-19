import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CheckStatus } from '@prisma/client';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { getRewrittenBodyText } from '../articles/rewritten-text.util';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';
import { checkRegexRules } from './compliance-rules';

interface CheckComplianceJobData {
  articleId: string;
}

@Processor(QUEUE_NAMES.COMPLIANCE)
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {
    super();
  }

  async process(job: Job<CheckComplianceJobData>): Promise<void> {
    const article = await this.articlesService.findById(job.data.articleId);
    const title = article.rewrittenTitle ?? '';
    // Incluye keyPoints/whyItMatters -- no solo rewrittenContent, ver
    // getRewrittenBodyText.
    const content = getRewrittenBodyText(article);

    const [regexViolations, aiResult] = await Promise.all([
      Promise.resolve(checkRegexRules(title, content)),
      this.llm.checkCompliance({ rewrittenTitle: title, rewrittenContent: content }),
    ]);

    const passes = regexViolations.length === 0 && aiResult.passes;
    const status = passes ? CheckStatus.APROBADO : CheckStatus.RECHAZADO;

    const report = {
      regexViolations,
      aiViolations: aiResult.violations,
      aiPasses: aiResult.passes,
    };

    await this.stateMachine.markComplianceResult(article.id, status, report);

    if (status === CheckStatus.APROBADO) {
      await this.stateMachine.submitForValidation(article.id);
      this.logger.log(`Articulo ${article.id} listo para validacion humana`);
    } else {
      this.logger.warn(
        `Cumplimiento RECHAZADO para ${article.id}: ${regexViolations.length} reglas regex, ` +
          `${aiResult.violations.length} violaciones detectadas por IA -- queda en triage humano`,
      );
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<CheckComplianceJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'COMPLIANCE', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de compliance: ${err}`));
  }
}
