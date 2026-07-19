import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IngestionRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE_RUN_CONFLICT_MESSAGE =
  'Ya hay una corrida de ingesta en curso -- esperá a que termine antes de lanzar otra.';

/// Bitacora de corridas de ingesta (ver comentario de IngestionRun en el
/// schema). No decide CUANDO disparar -- eso es responsabilidad de
/// IngestionDispatcher; este servicio solo lleva el registro.
@Injectable()
export class IngestionRunsService {
  constructor(private readonly prisma: PrismaService) {}

  /// Corrida que arranca de inmediato (boton "Correr ahora" o el cron
  /// automatico de Source.scheduledTime). userId es null para el cron
  /// automatico -- no hay un humano detras de esa.
  ///
  /// El indice UNIQUE parcial de la migracion 20260717190000 (WHERE
  /// status='EN_CURSO') es quien realmente garantiza que nunca haya dos
  /// corridas EN_CURSO a la vez -- IngestionDispatcher.assertNoActiveRun()
  /// ya filtra el caso comun antes de llegar aqui, pero dos requests casi
  /// simultaneos pueden pasar ese chequeo los dos (verificado en vivo
  /// disparando dos trigger-all en paralelo). Si eso pasa, Postgres
  /// rechaza el segundo INSERT y se traduce al mismo error de conflicto.
  async startNow(sourceCodes: string[], userId: string | null): Promise<IngestionRun> {
    try {
      return await this.prisma.ingestionRun.create({
        data: {
          triggerType: userId ? 'MANUAL' : 'SCHEDULED',
          status: 'EN_CURSO',
          sourceCodes: sourceCodes as Prisma.InputJsonValue,
          startedAt: new Date(),
          createdByUserId: userId ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(ACTIVE_RUN_CONFLICT_MESSAGE);
      }
      throw err;
    }
  }

  /// Programa una corrida unica a futuro (calendario, pestana Cola). Las
  /// fuentes se resuelven recien cuando el cron la dispara (pueden cambiar
  /// entre programar y disparar), por eso sourceCodes queda vacio aqui.
  async schedule(runAt: Date, userId: string): Promise<IngestionRun> {
    if (runAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha programada debe ser en el futuro');
    }
    return this.prisma.ingestionRun.create({
      data: {
        triggerType: 'MANUAL',
        status: 'PROGRAMADO',
        sourceCodes: [],
        startedAt: runAt,
        createdByUserId: userId,
      },
    });
  }

  async cancel(id: string): Promise<IngestionRun> {
    const run = await this.prisma.ingestionRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Corrida ${id} no encontrada`);
    if (run.status !== 'PROGRAMADO') {
      throw new BadRequestException('Solo se puede cancelar una corrida que aun no ha iniciado');
    }
    return this.prisma.ingestionRun.update({ where: { id }, data: { status: 'CANCELADO' } });
  }

  /// Corridas PROGRAMADO cuya fecha ya llego -- consultado por el cron
  /// de IngestionDispatcher cada minuto.
  findDueScheduled(now: Date): Promise<IngestionRun[]> {
    return this.prisma.ingestionRun.findMany({
      where: { status: 'PROGRAMADO', startedAt: { lte: now } },
    });
  }

  /// Corrida EN_CURSO (a lo sumo una a la vez, ver comentario de
  /// IngestionDispatcher sobre por que dos corridas simultaneas pueden
  /// dejar una huerfana en el tracker en memoria) -- consultado antes de
  /// disparar cualquier ingesta nueva, manual o automatica, para no
  /// lanzar una segunda mientras la anterior todavia no resuelve.
  findActiveRun(): Promise<IngestionRun | null> {
    return this.prisma.ingestionRun.findFirst({ where: { status: 'EN_CURSO' } });
  }

  /// Mismo indice UNIQUE parcial que startNow() -- ver su comentario.
  async markRunning(id: string, sourceCodes: string[]): Promise<void> {
    try {
      await this.prisma.ingestionRun.update({
        where: { id },
        data: { status: 'EN_CURSO', sourceCodes: sourceCodes as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(ACTIVE_RUN_CONFLICT_MESSAGE);
      }
      throw err;
    }
  }

  /// Fin de la etapa de ingesta (no del pipeline completo) -- ver
  /// IngestionRunTrackerService, que llama esto cuando todos los jobs
  /// de ingesta de la corrida ya resolvieron (completado o agotado sus
  /// reintentos).
  async markFinished(id: string): Promise<void> {
    await this.prisma.ingestionRun.update({
      where: { id },
      data: { status: 'COMPLETADO', finishedAt: new Date() },
    });
  }

  /// Crea todas las filas IngestionRunSource en PENDIENTE apenas arranca
  /// la corrida -- antes de encolar el primer job, para que no exista
  /// ventana donde un evento 'active' llegue sin fila que actualizar (ver
  /// comentario de IngestionRunSource en el schema).
  async initSourceProgress(runId: string, sources: { id: string; institutionCode: string }[]): Promise<void> {
    if (sources.length === 0) return;
    await this.prisma.ingestionRunSource.createMany({
      data: sources.map((s) => ({ runId, sourceId: s.id, institutionCode: s.institutionCode })),
    });
  }

  /// Llamado por IngestionRunTrackerService al recibir el evento 'active'
  /// de BullMQ para el job de esta fuente -- "se esta consultando en este
  /// momento" (pedido explicito del usuario 2026-07-17).
  async markSourceStarted(runId: string, sourceId: string): Promise<void> {
    await this.prisma.ingestionRunSource.updateMany({
      where: { runId, sourceId },
      data: { status: 'EN_CURSO', startedAt: new Date() },
    });
  }

  /// Llamado por IngestionRunTrackerService al recibir 'completed' o
  /// 'failed' (ya sin reintentos) del job de esta fuente.
  async markSourceFinished(
    runId: string,
    sourceId: string,
    params: { status: 'COMPLETADO' | 'ERROR'; itemsCreated?: number; itemsDuplicate?: number; errorMessage?: string },
  ): Promise<void> {
    await this.prisma.ingestionRunSource.updateMany({
      where: { runId, sourceId },
      data: {
        status: params.status,
        finishedAt: new Date(),
        itemsCreated: params.itemsCreated,
        itemsDuplicate: params.itemsDuplicate,
        errorMessage: params.errorMessage,
      },
    });
  }

  listRecent(limit = 20): Promise<IngestionRun[]> {
    return this.prisma.ingestionRun.findMany({
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        createdBy: { select: { name: true, email: true } },
        // orderBy createdAt asc = mismo orden en que se encolaron las
        // fuentes (initSourceProgress las crea en ese orden) -- el panel
        // muestra el "paso a paso" tal cual.
        sources: { orderBy: { createdAt: 'asc' } },
      },
    });
  }
}
