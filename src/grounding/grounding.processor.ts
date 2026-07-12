import { Inject, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { CheckStatus } from '@prisma/client';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { ArticlesService } from '../articles/articles.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { Claim } from '../llm/schemas/rewrite.schema';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { isTerminalFailure } from '../queue/is-terminal-failure.util';
import { findUngroundedNumerics } from './deterministic-diff.util';
import { RewriteArticleJobData } from '../rewrite/rewrite.processor';

interface GroundArticleJobData {
  articleId: string;
  claims: Claim[];
}

const MAX_AUTO_RETRIES = 1;

/// El modulo mas critico del pipeline: es la garantia estructural de que
/// "nada es inventado" no depende de que la IA se autocalifique. Corre
/// tres capas independientes (ver claims/verdicts/numericMismatches en
/// el reporte persistido) y solo aprueba si TODAS pasan.
@Processor(QUEUE_NAMES.GROUND)
export class GroundingProcessor extends WorkerHost {
  private readonly logger = new Logger(GroundingProcessor.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly stateMachine: ArticleStateMachineService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
    @InjectQueue(QUEUE_NAMES.COMPLIANCE) private readonly complianceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<GroundArticleJobData>): Promise<void> {
    const article = await this.articlesService.findById(job.data.articleId);
    const claims = job.data.claims ?? [];

    // Capa 2: verificacion adversarial independiente (prompt distinto,
    // sin saber que el texto es una "reescritura propia").
    const verification =
      claims.length > 0
        ? await this.llm.verifyClaims({ originalContent: article.originalContent, claims })
        : { verdicts: [] };

    // Capa 3: diff deterministico de numeros, sin IA.
    const numericMismatches = findUngroundedNumerics(
      article.originalContent,
      article.rewrittenContent ?? '',
    );

    const noSoportada = verification.verdicts.filter((v) => v.verdict === 'NO_SOPORTADA');
    const parcial = verification.verdicts.filter((v) => v.verdict === 'PARCIAL');
    const nullSpanClaims = claims.filter((c) => c.supportingSpanInOriginal === null);

    const status: CheckStatus =
      noSoportada.length > 0 || numericMismatches.length > 0 ? CheckStatus.RECHAZADO : CheckStatus.APROBADO;

    const report = {
      claims,
      verdicts: verification.verdicts,
      numericMismatches,
      nullSpanClaimsCount: nullSpanClaims.length,
      summary: {
        totalClaims: claims.length,
        noSoportada: noSoportada.length,
        parcial: parcial.length,
        numericMismatches: numericMismatches.length,
      },
    };

    const updated = await this.stateMachine.markGroundingResult(article.id, status, report);

    if (status === CheckStatus.APROBADO) {
      await this.complianceQueue.add(
        JOB_NAMES.CHECK_COMPLIANCE,
        { articleId: article.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
      );
      return;
    }

    this.logger.warn(
      `Grounding RECHAZADO para ${article.id}: ${noSoportada.length} claims no soportadas, ` +
        `${numericMismatches.length} numeros sin respaldo`,
    );

    if (updated.rewriteAttempts < MAX_AUTO_RETRIES + 1) {
      const feedback = this.buildRetryFeedback(noSoportada, numericMismatches);
      await this.rewriteQueue.add(
        JOB_NAMES.REWRITE_ARTICLE,
        { articleId: article.id, groundingFeedback: feedback } satisfies RewriteArticleJobData,
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
      );
      this.logger.log(`Reintento automatico de reescritura para ${article.id} (intento ${updated.rewriteAttempts + 1})`);
    } else {
      this.logger.warn(`${article.id} queda en GROUNDING_FALLIDO para triage humano (sin mas reintentos automaticos)`);
    }
  }

  private buildRetryFeedback(
    noSoportada: { claimText: string; explanation: string }[],
    numericMismatches: { value: string; context: string }[],
  ): string {
    const parts: string[] = [];
    if (noSoportada.length > 0) {
      parts.push(
        'Las siguientes afirmaciones NO estan respaldadas por el texto original -- no las repitas: ' +
          noSoportada.map((v) => `"${v.claimText}" (${v.explanation})`).join('; '),
      );
    }
    if (numericMismatches.length > 0) {
      parts.push(
        'Los siguientes numeros no aparecen en el texto original -- no los inventes ni los repitas: ' +
          numericMismatches.map((m) => m.value).join(', '),
      );
    }
    return parts.join(' | ');
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<GroundArticleJobData> | undefined, error: Error) {
    if (!isTerminalFailure(job) || !job) return;
    await this.stateMachine
      .markError(job.data.articleId, 'GROUNDING', error.message)
      .catch((err) => this.logger.error(`No se pudo marcar ERROR tras fallo de grounding: ${err}`));
  }
}
