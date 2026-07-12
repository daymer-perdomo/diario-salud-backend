import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Source } from '@prisma/client';
import { SourceRegistryService } from '../sources/source-registry.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { IngestionRunsService } from './ingestion-runs.service';
import { IngestionRunTrackerService } from './ingestion-run-tracker.service';

/// Cron ligero: solo decide "ya toca" y encola -- todo el trabajo
/// pesado/reintentable (fetch real) vive en IngestionProcessor via
/// BullMQ. jobId es determinista por minuto para que un doble-disparo
/// accidental del cron no genere dos jobs para la misma fuente.
///
/// Desde el incidente de agotamiento de credito (2026-07-12), este cron
/// SOLO dispara fuentes con Source.scheduledTime configurado -- ninguna
/// fuente ingiere sola por defecto. El boton "Correr ahora" del panel
/// (triggerAll) y las corridas programadas por calendario
/// (dispatchScheduledRuns) son las otras vias de disparo, siempre
/// iniciadas por un humano.
@Injectable()
export class IngestionDispatcher {
  private readonly logger = new Logger(IngestionDispatcher.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.INGEST) private readonly ingestQueue: Queue,
    private readonly sourceRegistry: SourceRegistryService,
    private readonly runsService: IngestionRunsService,
    private readonly runTracker: IngestionRunTrackerService,
  ) {}

  @Cron('*/2 * * * *')
  async dispatchDueSources(): Promise<void> {
    const now = new Date();
    const dueSources = await this.sourceRegistry.findDue(now);
    if (dueSources.length === 0) return;

    const run = await this.runsService.startNow(
      dueSources.map((s) => s.institutionCode),
      null,
    );
    const jobIds: string[] = [];
    for (const source of dueSources) {
      jobIds.push(await this.enqueueSource(source, now));
      await this.sourceRegistry.advanceSchedule(source.id, now);
    }
    this.runTracker.registerRun(run.id, jobIds);
  }

  /// Dispara las corridas programadas por calendario (pestana Cola) cuya
  /// fecha ya llego. Independiente del cron de horario diario por fuente.
  @Cron('* * * * *')
  async dispatchScheduledRuns(): Promise<void> {
    const now = new Date();
    const due = await this.runsService.findDueScheduled(now);
    if (due.length === 0) return;

    const activeSources = await this.sourceRegistry.findActive();
    for (const scheduledRun of due) {
      const jobIds: string[] = [];
      for (const source of activeSources) {
        jobIds.push(await this.enqueueSource(source, now));
      }
      await this.runsService.markRunning(
        scheduledRun.id,
        activeSources.map((s) => s.institutionCode),
      );
      this.runTracker.registerRun(scheduledRun.id, jobIds);
      this.logger.log(`Corrida programada ${scheduledRun.id} disparada: ${activeSources.length} fuente(s)`);
    }
  }

  /// Disparo manual del boton "Correr ahora": ingiere TODAS las fuentes
  /// activas de inmediato, sin importar su horario. No toca
  /// scheduledTime/nextRunAt -- el horario diario (si existe) sigue su
  /// curso independiente de este disparo puntual.
  async triggerAll(userId: string): Promise<{ triggered: number; sources: string[] }> {
    const now = new Date();
    const activeSources = await this.sourceRegistry.findActive();
    const sourceCodes = activeSources.map((s) => s.institutionCode);

    const run = await this.runsService.startNow(sourceCodes, userId);
    const jobIds: string[] = [];
    for (const source of activeSources) {
      jobIds.push(await this.enqueueSource(source, now));
    }
    this.runTracker.registerRun(run.id, jobIds);

    this.logger.log(`Disparo manual: ${activeSources.length} fuente(s) encolada(s)`);
    return { triggered: activeSources.length, sources: sourceCodes };
  }

  private async enqueueSource(source: Source, now: Date): Promise<string> {
    // BullMQ no permite ":" en un Custom Id -- toISOString() trae varios
    // (encontrado en produccion local: "Error: Custom Id cannot contain :").
    // Se usa el minuto epoch como entero, sin separadores problematicos.
    const minuteBucket = Math.floor(now.getTime() / 60_000);
    const jobId = `ingest-${source.id}-${minuteBucket}`;
    await this.ingestQueue.add(
      JOB_NAMES.INGEST_SOURCE,
      { sourceId: source.id },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    this.logger.log(`Encolada ingesta de ${source.institutionCode}`);
    return jobId;
  }
}
