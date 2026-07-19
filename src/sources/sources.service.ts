import { Injectable, NotFoundException } from '@nestjs/common';
import { ArticleState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { computeNextRunAt } from './next-run-at.util';

const VALIDATED_STATES: ArticleState[] = [ArticleState.VALIDADO, ArticleState.PUBLICADO];

/// CRUD del catalogo de fuentes -- unico punto de escritura sobre la
/// tabla `sources`. Debe quedar detras de RolesGuard(ADMIN) en el
/// controller: esta es la aplicacion estructural del "whitelist cerrado,
/// no editable por la IA" del brief.
@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  findAll() {
    return this.prisma.source.findMany({ orderBy: { institutionCode: 'asc' } });
  }

  async findOne(id: string) {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} no encontrada`);
    return source;
  }

  async create(dto: CreateSourceDto, actorUserId: string) {
    const source = await this.prisma.source.create({
      data: {
        institutionCode: dto.institutionCode,
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl,
        country: dto.country,
        fetchMethod: dto.fetchMethod,
        isActive: dto.isActive ?? true,
        // Sin scheduledTime, la fuente queda manual-only (nextRunAt=null) --
        // ninguna fuente nueva ingiere sola salvo que se configure explicitamente.
        scheduledTime: dto.scheduledTime ?? null,
        nextRunAt: dto.scheduledTime ? computeNextRunAt(dto.scheduledTime, new Date()) : null,
        config: dto.config as Prisma.InputJsonValue,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      entityType: 'Source',
      entityId: source.id,
      action: 'CREATED',
      actorType: 'HUMAN',
      actorId: actorUserId,
      payload: { institutionCode: source.institutionCode },
    });

    return source;
  }

  async update(id: string, dto: UpdateSourceDto, actorUserId: string) {
    await this.findOne(id);

    // scheduledTime maneja su propio recalculo de nextRunAt -- si viene
    // en el body (incluso como null, para desactivar el horario), se
    // recalcula aqui; si no viene, no se toca ninguno de los dos campos.
    const scheduleUpdate =
      'scheduledTime' in dto
        ? {
            scheduledTime: dto.scheduledTime,
            nextRunAt: dto.scheduledTime ? computeNextRunAt(dto.scheduledTime, new Date()) : null,
          }
        : {};

    const source = await this.prisma.source.update({
      where: { id },
      data: {
        ...dto,
        ...scheduleUpdate,
        config: dto.config as Prisma.InputJsonValue | undefined,
        updatedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      entityType: 'Source',
      entityId: source.id,
      action: 'UPDATED',
      actorType: 'HUMAN',
      actorId: actorUserId,
      payload: dto as Record<string, unknown>,
    });

    return source;
  }

  async setActive(id: string, isActive: boolean, actorUserId: string) {
    return this.update(id, { isActive }, actorUserId);
  }

  /// Brief seccion 4 (whitelist cerrado): esto es lo que demuestra que la
  /// informacion realmente sale de las fuentes autorizadas y cuales de
  /// ellas producen resultados de valor -- no solo cuales estan
  /// "activas" en configuracion, sino cuantos articulos han traido, que
  /// tan relevantes resultaron (segun Scoring) y cuantos llegaron a ser
  /// validados/publicados por un humano. Usado por la pestaña Guia.
  async getStats() {
    const sources = await this.prisma.source.findMany({ orderBy: { institutionCode: 'asc' } });

    const [totals, relevant, validatedOrPublished] = await Promise.all([
      this.prisma.article.groupBy({ by: ['sourceId'], _count: { _all: true } }),
      this.prisma.article.groupBy({
        by: ['sourceId'],
        where: { isRelevant: true },
        _count: { _all: true },
        _avg: { relevanceScore: true },
      }),
      this.prisma.article.groupBy({
        by: ['sourceId'],
        where: { state: { in: VALIDATED_STATES } },
        _count: { _all: true },
      }),
    ]);

    const totalsBySource = new Map(totals.map((t) => [t.sourceId, t._count._all]));
    const relevantBySource = new Map(relevant.map((r) => [r.sourceId, { count: r._count._all, avgScore: r._avg.relevanceScore }]));
    const validatedBySource = new Map(validatedOrPublished.map((v) => [v.sourceId, v._count._all]));

    return sources.map((source) => ({
      id: source.id,
      institutionCode: source.institutionCode,
      name: source.name,
      country: source.country,
      type: source.type,
      isActive: source.isActive,
      totalIngested: totalsBySource.get(source.id) ?? 0,
      relevantCount: relevantBySource.get(source.id)?.count ?? 0,
      avgRelevanceScore: relevantBySource.get(source.id)?.avgScore ?? null,
      validatedOrPublishedCount: validatedBySource.get(source.id) ?? 0,
    }));
  }
}
