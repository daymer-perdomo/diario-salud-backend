import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SourceRegistryService } from '../sources/source-registry.service';
import { AdapterFactory } from '../sources/adapters/adapter.factory';
import { ArticlesService } from '../articles/articles.service';
import { AuditLogService } from '../audit/audit-log.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

interface IngestSourceJobData {
  sourceId: string;
}

/// Procesa un job de ingesta por fuente. Nunca fabrica contenido: si el
/// adapter falla, el error se propaga (BullMQ reintenta con backoff) y
/// solo al agotar los intentos se registra el fallo -- no se crea ninguna
/// fila Article de relleno. Los duplicados exactos (misma
/// sourceId+contentHash) se detectan por el @@unique de Prisma dentro de
/// ArticlesService.createFromCandidate y se cuentan, no se tratan como error.
@Processor(QUEUE_NAMES.INGEST)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly sourceRegistry: SourceRegistryService,
    private readonly adapterFactory: AdapterFactory,
    private readonly articlesService: ArticlesService,
    private readonly audit: AuditLogService,
    @InjectQueue(QUEUE_NAMES.FILTER) private readonly filterQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IngestSourceJobData>): Promise<{ created: number; duplicates: number }> {
    const { sourceId } = job.data;
    const source = await this.sourceRegistry.getById(sourceId);
    const adapter = this.adapterFactory.get(source.type);

    try {
      const result = await adapter.fetchCandidates(source, source.lastSuccessfulCursor);

      let created = 0;
      let duplicates = 0;
      for (const candidate of result.items) {
        const article = await this.articlesService.createFromCandidate(
          source.id,
          source.name,
          candidate,
        );
        if (article) {
          created += 1;
          await this.filterQueue.add(
            JOB_NAMES.FILTER_ARTICLE,
            { articleId: article.id },
            { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
          );
        } else {
          duplicates += 1;
        }
      }

      await this.sourceRegistry.recordFetchSuccess(sourceId, result.nextCursor);
      this.logger.log(
        `Ingesta ${source.institutionCode}: ${created} nuevos, ${duplicates} duplicados omitidos`,
      );
      return { created, duplicates };
    } catch (err) {
      await this.sourceRegistry.recordFetchFailure(sourceId);
      await this.audit.record({
        entityType: 'Source',
        entityId: sourceId,
        action: 'FETCH_FAILED',
        actorType: 'SYSTEM',
        payload: { message: (err as Error).message, attempt: job.attemptsMade },
      });
      // Se relanza para que BullMQ aplique su backoff/reintento -- ninguna
      // fila Article se crea a partir de un fetch fallido.
      throw err;
    }
  }
}
