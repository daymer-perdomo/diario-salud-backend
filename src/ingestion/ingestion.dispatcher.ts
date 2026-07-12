import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Source } from '@prisma/client';
import { SourceRegistryService } from '../sources/source-registry.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/// Cron ligero: solo decide "ya toca" y encola -- todo el trabajo
/// pesado/reintentable (fetch real) vive en IngestionProcessor via
/// BullMQ. jobId es determinista por minuto para que un doble-disparo
/// accidental del cron no genere dos jobs para la misma fuente.
///
/// Desde el incidente de agotamiento de credito (2026-07-12), este cron
/// SOLO dispara fuentes con Source.scheduledTime configurado -- ninguna
/// fuente ingiere sola por defecto. El boton "Consultar ahora" del panel
/// (triggerAll) es la otra via de disparo, totalmente manual.
@Injectable()
export class IngestionDispatcher {
  private readonly logger = new Logger(IngestionDispatcher.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.INGEST) private readonly ingestQueue: Queue,
    private readonly sourceRegistry: SourceRegistryService,
  ) {}

  @Cron('*/2 * * * *')
  async dispatchDueSources(): Promise<void> {
    const now = new Date();
    const dueSources = await this.sourceRegistry.findDue(now);

    for (const source of dueSources) {
      await this.enqueueSource(source, now);
      await this.sourceRegistry.advanceSchedule(source.id, now);
    }
  }

  /// Disparo manual del boton "Consultar ahora": ingiere TODAS las
  /// fuentes activas de inmediato, sin importar su horario. No toca
  /// scheduledTime/nextRunAt -- el horario diario (si existe) sigue su
  /// curso independiente de este disparo puntual.
  async triggerAll(): Promise<{ triggered: number; sources: string[] }> {
    const now = new Date();
    const activeSources = await this.sourceRegistry.findActive();

    for (const source of activeSources) {
      await this.enqueueSource(source, now);
    }

    this.logger.log(`Disparo manual: ${activeSources.length} fuente(s) encolada(s)`);
    return {
      triggered: activeSources.length,
      sources: activeSources.map((s) => s.institutionCode),
    };
  }

  private async enqueueSource(source: Source, now: Date): Promise<void> {
    // BullMQ no permite ":" en un Custom Id -- toISOString() trae varios
    // (encontrado en produccion local: "Error: Custom Id cannot contain :").
    // Se usa el minuto epoch como entero, sin separadores problematicos.
    const minuteBucket = Math.floor(now.getTime() / 60_000);
    await this.ingestQueue.add(
      JOB_NAMES.INGEST_SOURCE,
      { sourceId: source.id },
      {
        jobId: `ingest-${source.id}-${minuteBucket}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    this.logger.log(`Encolada ingesta de ${source.institutionCode}`);
  }
}
