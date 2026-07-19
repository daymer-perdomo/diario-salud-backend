import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ArticleState, Source } from '@prisma/client';
import { SourceRegistryService } from '../sources/source-registry.service';
import { SourcesService } from '../sources/sources.service';
import { PrismaService } from '../prisma/prisma.service';
import { RewriteSelectionService } from '../rewrite/rewrite-selection.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { IngestionRunsService } from './ingestion-runs.service';
import { IngestionRunTrackerService } from './ingestion-run-tracker.service';

/// Cuantos items mas se agregan al tope de la fuente por cada click en
/// "Buscar otras 3" (ver fetchMore) -- mismo numero que el default de
/// items conservados en el fetch inicial (ver DEFAULT_MAX_ITEMS_PER_RUN
/// en cada adapter).
const FETCH_MORE_BATCH_SIZE = 3;

/// Parametros del watcher de "todo el flujo" (ver waitForScoringAndSelect):
/// cuantas veces seguidas tiene que leer 0 pendientes antes de confiar en
/// que el scoring termino de verdad -- una sola lectura en 0 puede ser un
/// instante vacio entre jobs, no el final real (encontrado en vivo
/// 2026-07-17 verificando esto mismo a mano con un script).
const SCORING_POLL_INTERVAL_MS = 5_000;
const SCORING_STABLE_READS_REQUIRED = 3;
const SCORING_MAX_WAIT_MS = 10 * 60 * 1000;

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
    private readonly sourcesService: SourcesService,
    private readonly prisma: PrismaService,
    private readonly rewriteSelection: RewriteSelectionService,
    private readonly runsService: IngestionRunsService,
    private readonly runTracker: IngestionRunTrackerService,
  ) {}

  @Cron('*/2 * * * *')
  async dispatchDueSources(): Promise<void> {
    const now = new Date();
    const dueSources = await this.sourceRegistry.findDue(now);
    if (dueSources.length === 0) return;

    // No lanzar una corrida nueva mientras otra sigue EN_CURSO -- esta
    // simplemente se salta este tick, el cron vuelve a intentar en 2 min
    // (las fuentes due no se pierden, findDue las vuelve a traer).
    if (await this.runsService.findActiveRun()) {
      this.logger.log('Ya hay una corrida en curso -- se pospone el disparo automatico de fuentes con horario');
      return;
    }

    // Ventana de carrera residual entre el chequeo de arriba y este
    // create() (ver comentario de IngestionRunsService.startNow()) --
    // el indice UNIQUE parcial es quien decide de verdad, esto solo
    // evita que un ConflictException tumbe el cron.
    let run;
    try {
      run = await this.runsService.startNow(
        dueSources.map((s) => s.institutionCode),
        null,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.log('Otra corrida gano la carrera -- se pospone el disparo automatico de fuentes con horario');
        return;
      }
      throw err;
    }

    await this.runsService.initSourceProgress(
      run.id,
      dueSources.map((s) => ({ id: s.id, institutionCode: s.institutionCode })),
    );

    const jobs: { jobId: string; sourceId: string }[] = [];
    for (const source of dueSources) {
      jobs.push({ jobId: await this.enqueueSource(source, now), sourceId: source.id });
      await this.sourceRegistry.advanceSchedule(source.id, now);
    }
    this.runTracker.registerRun(run.id, jobs);
  }

  /// Dispara las corridas programadas por calendario (pestana Cola) cuya
  /// fecha ya llego. Independiente del cron de horario diario por fuente.
  @Cron('* * * * *')
  async dispatchScheduledRuns(): Promise<void> {
    const now = new Date();
    const due = await this.runsService.findDueScheduled(now);
    if (due.length === 0) return;

    // Mismo criterio que dispatchDueSources: si ya hay una corrida
    // EN_CURSO, esta se queda PROGRAMADO y se reintenta el proximo minuto.
    if (await this.runsService.findActiveRun()) {
      this.logger.log('Ya hay una corrida en curso -- se pospone el disparo de corridas programadas por calendario');
      return;
    }

    const activeSources = await this.sourceRegistry.findActive();
    for (const scheduledRun of due) {
      const jobs: { jobId: string; sourceId: string }[] = [];
      for (const source of activeSources) {
        jobs.push({ jobId: await this.enqueueSource(source, now), sourceId: source.id });
      }
      try {
        await this.runsService.markRunning(
          scheduledRun.id,
          activeSources.map((s) => s.institutionCode),
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          // Ventana de carrera residual (ver dispatchDueSources) -- esta
          // corrida queda PROGRAMADO, se reintenta el proximo minuto; las
          // que sigan en `due` tambien se posponen, no tiene sentido
          // seguir si ya hay una EN_CURSO.
          this.logger.log(`Otra corrida gano la carrera -- se pospone la corrida programada ${scheduledRun.id}`);
          return;
        }
        throw err;
      }
      await this.runsService.initSourceProgress(
        scheduledRun.id,
        activeSources.map((s) => ({ id: s.id, institutionCode: s.institutionCode })),
      );
      this.runTracker.registerRun(scheduledRun.id, jobs);
      this.logger.log(`Corrida programada ${scheduledRun.id} disparada: ${activeSources.length} fuente(s)`);
    }
  }

  /// Disparo manual del boton "Consultar fuentes ahora": ingiere TODAS las
  /// fuentes activas de inmediato, sin importar su horario. No toca
  /// scheduledTime/nextRunAt -- el horario diario (si existe) sigue su
  /// curso independiente de este disparo puntual.
  ///
  /// 2026-07-17 (pedido explicito del usuario): "cuando ejecute esa
  /// accion, todo el flujo se debe ejecutar" -- este boton ya no se queda
  /// esperando un segundo click en "Seleccionar mejores ahora". Dispara
  /// el fetch normal y, en segundo plano (fire-and-forget, no bloquea la
  /// respuesta HTTP), espera a que el scoring de ESTOS articulos
  /// especificos termine y llama a RewriteSelectionService.runSelection()
  /// sola -- ver waitForScoringAndSelect. Los topes de siempre
  /// (DAILY_REWRITE_LIMIT, MIN_RELEVANCE_SCORE_FOR_REWRITE,
  /// MAX_LLM_BUDGET_USD) se siguen aplicando igual, esto solo saca el
  /// click manual de en medio.
  async triggerAll(userId: string): Promise<{ triggered: number; sources: string[] }> {
    await this.assertNoActiveRun();

    const now = new Date();
    const activeSources = await this.sourceRegistry.findActive();
    const sourceCodes = activeSources.map((s) => s.institutionCode);

    const run = await this.runsService.startNow(sourceCodes, userId);
    await this.runsService.initSourceProgress(
      run.id,
      activeSources.map((s) => ({ id: s.id, institutionCode: s.institutionCode })),
    );

    const jobs: { jobId: string; sourceId: string }[] = [];
    for (const source of activeSources) {
      jobs.push({ jobId: await this.enqueueSource(source, now), sourceId: source.id });
    }
    this.runTracker.registerRun(run.id, jobs);

    this.logger.log(`Disparo manual: ${activeSources.length} fuente(s) encolada(s)`);

    if (activeSources.length > 0) {
      this.waitForScoringAndSelect(
        run.id,
        activeSources.map((s) => s.id),
        now,
      ).catch((err) => this.logger.error(`Watcher de seleccion automatica fallo: ${(err as Error).message}`));
    }

    return { triggered: activeSources.length, sources: sourceCodes };
  }

  /// Espera a que los articulos creados por ESTA corrida (sourceId +
  /// createdAt >= disparo) dejen de estar en RECOLECTADO -- es decir, a
  /// que filter+score terminen de resolverlos (a DESCARTADO, EVALUADO o
  /// ERROR) -- y entonces dispara la seleccion diaria sola.
  ///
  /// Bug real encontrado 2026-07-17: chequear SOLO el conteo de
  /// RECOLECTADO no alcanza -- si una fuente lenta (ej. ADRES con fetches
  /// extra de imagen de detalle) todavia no termino su propio job de
  /// ingesta, sus articulos ni siquiera EXISTEN todavia, asi que el
  /// conteo daba 0 (falso positivo) y la seleccion se disparaba antes de
  /// que esa fuente aportara sus candidatos -- se verificado en vivo:
  /// selecciono con 7 EVALUADO y 2 mas aparecieron despues, sin
  /// oportunidad de entrar a esa seleccion. Por eso primero se espera a
  /// que IngestionRun.status llegue a COMPLETADO (lo marca
  /// IngestionRunTrackerService cuando TODOS los jobs de ingesta de la
  /// corrida ya resolvieron) antes de siquiera empezar a contar
  /// RECOLECTADO.
  private async waitForScoringAndSelect(runId: string, sourceIds: string[], since: Date): Promise<void> {
    const deadline = Date.now() + SCORING_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SCORING_POLL_INTERVAL_MS));
      const run = await this.prisma.ingestionRun.findUnique({ where: { id: runId } });
      if (run?.status === 'COMPLETADO') break;
    }

    let stableReads = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SCORING_POLL_INTERVAL_MS));

      const pending = await this.prisma.article.count({
        where: { sourceId: { in: sourceIds }, createdAt: { gte: since }, state: ArticleState.RECOLECTADO },
      });

      if (pending === 0) {
        stableReads += 1;
        if (stableReads >= SCORING_STABLE_READS_REQUIRED) {
          this.logger.log('Scoring de la corrida terminado -- disparando seleccion automatica');
          await this.rewriteSelection.runSelection();
          return;
        }
      } else {
        stableReads = 0;
      }
    }

    this.logger.warn(
      'Se agoto el tiempo de espera del watcher de seleccion automatica sin que el scoring terminara -- ' +
        'no se disparo la seleccion. Usar el boton "Seleccionar mejores ahora" manualmente.',
    );
  }

  /// Boton "Buscar otras 3" del panel, por fuente (2026-07-17, pedido
  /// explicito del usuario): si en la revision humana ninguna de las
  /// primeras Source.maxItemsPerRun candidatas de una fuente sirvio, esto
  /// sube el tope +3 y vuelve a disparar el fetch de ESA fuente sola --
  /// nunca dispara las demas. Como los adapters siempre devuelven las
  /// mas recientes dentro de la ventana ordenadas por fecha, subir el
  /// tope trae exactamente los siguientes 3 candidatos; los ya creados
  /// como Article se saltan solos por el @@unique de contentHash (mismo
  /// mecanismo de deduplicacion que ya usa IngestionProcessor, no hace
  /// falta un cursor/offset nuevo).
  async fetchMore(sourceId: string, userId: string): Promise<{ sourceCode: string; newLimit: number }> {
    await this.assertNoActiveRun();

    const source = await this.sourceRegistry.getById(sourceId);
    const newLimit = (source.maxItemsPerRun ?? FETCH_MORE_BATCH_SIZE) + FETCH_MORE_BATCH_SIZE;
    const updated = await this.sourcesService.update(sourceId, { maxItemsPerRun: newLimit }, userId);

    const run = await this.runsService.startNow([updated.institutionCode], userId);
    await this.runsService.initSourceProgress(run.id, [{ id: updated.id, institutionCode: updated.institutionCode }]);
    const jobId = await this.enqueueSource(updated, new Date());
    this.runTracker.registerRun(run.id, [{ jobId, sourceId: updated.id }]);

    this.logger.log(`Buscar mas: ${updated.institutionCode} -> tope subido a ${newLimit}`);
    return { sourceCode: updated.institutionCode, newLimit };
  }

  /// Guarda comun de los disparos manuales (triggerAll/fetchMore): pedido
  /// explicito del usuario 2026-07-17 tras encontrar en vivo que dos
  /// corridas EN_CURSO simultaneas pueden dejar una huerfana en el
  /// tracker en memoria (ver comentario de IngestionRunTrackerService).
  /// En vez de solo mitigar el sintoma (tracker con Set de runIds), esto
  /// ataca la causa: nunca dejar que exista una segunda corrida mientras
  /// la anterior no resolvio. Los disparos automaticos (cron) no lanzan
  /// esta excepcion -- simplemente se posponen al siguiente tick, ver
  /// dispatchDueSources/dispatchScheduledRuns.
  private async assertNoActiveRun(): Promise<void> {
    const active = await this.runsService.findActiveRun();
    if (active) {
      const startedLabel = active.startedAt ? active.startedAt.toLocaleTimeString('es-CO') : 'hace un momento';
      throw new ConflictException(
        `Ya hay una corrida de ingesta en curso (iniciada ${startedLabel}) -- esperá a que termine antes de lanzar otra.`,
      );
    }
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
