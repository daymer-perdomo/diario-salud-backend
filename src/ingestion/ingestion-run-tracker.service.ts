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

interface RegisteredJob {
  jobId: string;
  sourceId: string;
}

/// Detecta cuando termina la etapa de ingesta de una corrida (todos sus
/// jobs de la cola `ingest` resolvieron) escuchando los eventos de BullMQ
/// directamente -- no hace falta que el Job siga vivo en Redis
/// (removeOnComplete/removeOnFail), QueueEvents lee del stream de eventos.
/// Ademas (2026-07-17, pedido explicito del usuario: "muestra que fuente
/// se esta consultando en ese momento, paso a paso") actualiza el
/// progreso por fuente de CADA corrida via IngestionRunSource, escuchando
/// tambien el evento 'active'.
///
/// Limitacion aceptada: si el proceso se reinicia a mitad de una corrida,
/// su registro en memoria (jobToRun/jobToSource/pending) se pierde y esa
/// fila de IngestionRun se queda sin finishedAt (y las fuentes que
/// todavia no habian resuelto se quedan en PENDIENTE/EN_CURSO) -- no
/// afecta el pipeline en si, solo el historial visual del panel.
///
/// Bug real encontrado 2026-07-17: jobId es deterministico por fuente+minuto
/// (ver IngestionDispatcher.enqueueSource) a proposito, para que un
/// doble-disparo (dos clicks en "Correr ahora"/"Consultar fuentes ahora"
/// dentro del mismo minuto) no encole trabajo de scraping duplicado -- BullMQ
/// devuelve el job ya existente en vez de crear uno nuevo. Pero eso significa
/// que DOS corridas (dos filas de IngestionRun con runId distinto) pueden
/// terminar registrando exactamente los mismos jobIds. Con jobToRun como
/// Map<string,string> (un solo runId por jobId), el segundo registerRun()
/// pisaba el mapeo del primero -- la corrida "perdedora" nunca volvia a
/// recibir su evento 'completed'/'failed' y quedaba en EN_CURSO para
/// siempre (verificado en vivo: dos IngestionRun con el mismo sourceCodes,
/// arrancadas 1 segundo aparte, una COMPLETADO y la otra huerfana). Por eso
/// jobToRun mapea a un Set de runIds -- settle() debe notificar a TODAS las
/// corridas que comparten ese jobId, no solo a la ultima registrada. Desde
/// que existe el indice UNIQUE parcial (migracion 20260717190000) esto ya
/// no puede volver a pasar en la practica, pero el Set se deja igual --
/// es la representacion correcta del dato, no un parche.
@Injectable()
export class IngestionRunTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionRunTrackerService.name);
  private queueEvents: QueueEvents;
  private readonly jobToRun = new Map<string, Set<string>>();
  private readonly jobToSource = new Map<string, string>();
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
    this.queueEvents.on('active', ({ jobId }) => this.onActive(jobId));
    this.queueEvents.on('completed', ({ jobId, returnvalue }) => this.onCompleted(jobId, returnvalue));
    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      this.onFailed(jobId, failedReason).catch((err) =>
        this.logger.error(`Error procesando fallo de job ${jobId}: ${(err as Error).message}`),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  /// Se llama justo despues de encolar todos los jobs de ingesta de una
  /// corrida (manual, programada o del cron automatico) para poder
  /// detectar cuando la ultima resuelve y marcar finishedAt, y para poder
  /// resolver sourceId al recibir cada evento de BullMQ.
  registerRun(runId: string, jobs: RegisteredJob[]): void {
    if (jobs.length === 0) {
      void this.runsService.markFinished(runId);
      return;
    }
    this.pending.set(runId, { remaining: jobs.length });
    for (const { jobId, sourceId } of jobs) {
      const runIds = this.jobToRun.get(jobId) ?? new Set<string>();
      runIds.add(runId);
      this.jobToRun.set(jobId, runIds);
      // sourceId es intrinseco al jobId (ver enqueueSource) -- da igual
      // que corrida lo registre primero, siempre es el mismo valor.
      this.jobToSource.set(jobId, sourceId);
    }
  }

  private onActive(jobId: string): void {
    const runIds = this.jobToRun.get(jobId);
    const sourceId = this.jobToSource.get(jobId);
    if (!runIds || !sourceId) return;
    for (const runId of runIds) {
      this.runsService
        .markSourceStarted(runId, sourceId)
        .catch((err) => this.logger.error(`No se pudo marcar fuente en curso (run ${runId}): ${(err as Error).message}`));
    }
  }

  private onCompleted(jobId: string, returnvalue: unknown): void {
    const parsed = this.parseReturnValue(returnvalue);
    this.settle(jobId, { status: 'COMPLETADO', itemsCreated: parsed?.created, itemsDuplicate: parsed?.duplicates });
  }

  /// BullMQ emite 'failed' en cada intento fallido, no solo en el
  /// definitivo -- hay que confirmar que ya agoto sus reintentos antes
  /// de contar el job como resuelto (si no, la corrida se marcaria
  /// terminada mientras el job todavia esta reintentando con backoff).
  private async onFailed(jobId: string, failedReason: string): Promise<void> {
    if (!this.jobToRun.has(jobId)) return;
    const job = await this.ingestQueue.getJob(jobId);
    const attemptsMade = job?.attemptsMade ?? Infinity;
    const maxAttempts = job?.opts?.attempts ?? 0;
    if (job && attemptsMade < maxAttempts) return; // aun le quedan reintentos
    this.settle(jobId, { status: 'ERROR', errorMessage: failedReason });
  }

  /// Pese a que el .d.ts de bullmq declara `returnvalue: string`, en
  /// runtime la libreria ya lo parsea internamente antes de emitir el
  /// evento (ver JSON.parse dentro de queue-events.js) -- verificado en
  /// vivo 2026-07-17 con un log de depuracion: llegaba como objeto, no
  /// como string, y JSON.parse(objeto) fallaba silenciosamente (try/catch
  /// devolvia null) dejando itemsCreated/itemsDuplicate siempre en null.
  /// Se acepta ambas formas por si una version futura de bullmq vuelve a
  /// entregarlo como string.
  private parseReturnValue(raw: unknown): { created?: number; duplicates?: number } | null {
    if (raw && typeof raw === 'object') return raw as { created?: number; duplicates?: number };
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private settle(
    jobId: string,
    outcome: { status: 'COMPLETADO' | 'ERROR'; itemsCreated?: number; itemsDuplicate?: number; errorMessage?: string },
  ): void {
    const runIds = this.jobToRun.get(jobId);
    const sourceId = this.jobToSource.get(jobId);
    if (!runIds) return;
    this.jobToRun.delete(jobId);
    this.jobToSource.delete(jobId);

    for (const runId of runIds) {
      if (sourceId) {
        this.runsService
          .markSourceFinished(runId, sourceId, outcome)
          .catch((err) => this.logger.error(`No se pudo marcar fuente terminada (run ${runId}): ${(err as Error).message}`));
      }

      const run = this.pending.get(runId);
      if (!run) continue;
      run.remaining -= 1;
      if (run.remaining <= 0) {
        this.pending.delete(runId);
        this.runsService
          .markFinished(runId)
          .catch((err) => this.logger.error(`No se pudo marcar corrida ${runId} como terminada: ${(err as Error).message}`));
      }
    }
  }
}
