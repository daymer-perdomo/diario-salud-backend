import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { buildRedisConnectionOptions } from '../config/redis-connection.util';
import { IngestionRunsService } from './ingestion-runs.service';

interface PendingRun {
  remaining: number;
}

/// Detecta cuando termina la etapa de ingesta de una corrida (todos sus
/// jobs de la cola `ingest` resolvieron) escuchando los eventos de BullMQ
/// directamente -- no hace falta que el Job siga vivo en Redis
/// (removeOnComplete/removeOnFail), QueueEvents lee del stream de eventos.
/// Limitacion aceptada: si el proceso se reinicia a mitad de una corrida,
/// su registro en memoria (jobToRun/pending) se pierde y esa fila de
/// IngestionRun se queda sin finishedAt -- no afecta el pipeline en si,
/// solo el historial visual del panel.
@Injectable()
export class IngestionRunTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionRunTrackerService.name);
  private queueEvents: QueueEvents;
  private readonly jobToRun = new Map<string, string>();
  private readonly pending = new Map<string, PendingRun>();

  constructor(
    private readonly config: ConfigService,
    private readonly runsService: IngestionRunsService,
    @InjectQueue(QUEUE_NAMES.INGEST) private readonly ingestQueue: Queue,
  ) {}

  onModuleInit(): void {
    this.queueEvents = new QueueEvents(QUEUE_NAMES.INGEST, {
      connection: buildRedisConnectionOptions(this.config),
    });
    this.queueEvents.on('completed', ({ jobId }) => this.onCompleted(jobId));
    this.queueEvents.on('failed', ({ jobId }) => {
      this.onFailed(jobId).catch((err) =>
        this.logger.error(`Error procesando fallo de job ${jobId}: ${(err as Error).message}`),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  /// Se llama justo despues de encolar todos los jobs de ingesta de una
  /// corrida (manual, programada o del cron automatico) para poder
  /// detectar cuando la ultima resuelve y marcar finishedAt.
  registerRun(runId: string, jobIds: string[]): void {
    if (jobIds.length === 0) {
      void this.runsService.markFinished(runId);
      return;
    }
    this.pending.set(runId, { remaining: jobIds.length });
    for (const jobId of jobIds) this.jobToRun.set(jobId, runId);
  }

  private onCompleted(jobId: string): void {
    this.settle(jobId);
  }

  /// BullMQ emite 'failed' en cada intento fallido, no solo en el
  /// definitivo -- hay que confirmar que ya agoto sus reintentos antes
  /// de contar el job como resuelto (si no, la corrida se marcaria
  /// terminada mientras el job todavia esta reintentando con backoff).
  private async onFailed(jobId: string): Promise<void> {
    if (!this.jobToRun.has(jobId)) return;
    const job = await this.ingestQueue.getJob(jobId);
    const attemptsMade = job?.attemptsMade ?? Infinity;
    const maxAttempts = job?.opts?.attempts ?? 0;
    if (job && attemptsMade < maxAttempts) return; // aun le quedan reintentos
    this.settle(jobId);
  }

  private settle(jobId: string): void {
    const runId = this.jobToRun.get(jobId);
    if (!runId) return;
    this.jobToRun.delete(jobId);
    const run = this.pending.get(runId);
    if (!run) return;
    run.remaining -= 1;
    if (run.remaining <= 0) {
      this.pending.delete(runId);
      this.runsService
        .markFinished(runId)
        .catch((err) => this.logger.error(`No se pudo marcar corrida ${runId} como terminada: ${(err as Error).message}`));
    }
  }
}
