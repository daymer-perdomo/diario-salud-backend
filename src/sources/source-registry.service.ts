import { Injectable, NotFoundException } from '@nestjs/common';
import { Source } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeNextRunAt } from './next-run-at.util';

/// Acceso de SOLO LECTURA al catalogo de fuentes para el resto del
/// pipeline (Ingestion, etc). Ningun modulo de procesamiento debe poder
/// crear o editar una Source -- eso es responsabilidad exclusiva de
/// SourcesService, detras de RolesGuard(ADMIN).
@Injectable()
export class SourceRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} no encontrada en el catalogo`);
    return source;
  }

  /// Fuentes con horario diario configurado (scheduledTime != null) cuyo
  /// proximo disparo ya vencio -- usado por el dispatcher cron de
  /// IngestionModule. Las fuentes manual-only (scheduledTime = null)
  /// nunca aparecen aqui, sin importar isActive.
  findDue(now: Date): Promise<Source[]> {
    return this.prisma.source.findMany({
      where: { isActive: true, scheduledTime: { not: null }, nextRunAt: { lte: now } },
    });
  }

  /// Todas las fuentes activas, para el boton "Consultar ahora" -- ese
  /// disparo manual ignora el horario, solo respeta isActive.
  findActive(): Promise<Source[]> {
    return this.prisma.source.findMany({ where: { isActive: true } });
  }

  async advanceSchedule(sourceId: string, now: Date): Promise<void> {
    const source = await this.getById(sourceId);
    if (!source.scheduledTime) return;
    const nextRunAt = computeNextRunAt(source.scheduledTime, now);
    await this.prisma.source.update({ where: { id: sourceId }, data: { nextRunAt } });
  }

  async recordFetchFailure(sourceId: string): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { consecutiveFailures: { increment: 1 } },
    });
  }

  async recordFetchSuccess(sourceId: string, nextCursor: unknown | null): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        consecutiveFailures: 0,
        lastSuccessfulCursor: nextCursor === null ? undefined : (nextCursor as any),
      },
    });
  }
}
