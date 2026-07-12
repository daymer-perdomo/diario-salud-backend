import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IngestionRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Bitacora de corridas de ingesta (ver comentario de IngestionRun en el
/// schema). No decide CUANDO disparar -- eso es responsabilidad de
/// IngestionDispatcher; este servicio solo lleva el registro.
@Injectable()
export class IngestionRunsService {
  constructor(private readonly prisma: PrismaService) {}

  /// Corrida que arranca de inmediato (boton "Correr ahora" o el cron
  /// automatico de Source.scheduledTime). userId es null para el cron
  /// automatico -- no hay un humano detras de esa.
  startNow(sourceCodes: string[], userId: string | null): Promise<IngestionRun> {
    return this.prisma.ingestionRun.create({
      data: {
        triggerType: userId ? 'MANUAL' : 'SCHEDULED',
        status: 'EN_CURSO',
        sourceCodes: sourceCodes as Prisma.InputJsonValue,
        startedAt: new Date(),
        createdByUserId: userId ?? undefined,
      },
    });
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

  async markRunning(id: string, sourceCodes: string[]): Promise<void> {
    await this.prisma.ingestionRun.update({
      where: { id },
      data: { status: 'EN_CURSO', sourceCodes: sourceCodes as Prisma.InputJsonValue },
    });
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

  listRecent(limit = 20): Promise<IngestionRun[]> {
    return this.prisma.ingestionRun.findMany({
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { createdBy: { select: { name: true, email: true } } },
    });
  }
}
