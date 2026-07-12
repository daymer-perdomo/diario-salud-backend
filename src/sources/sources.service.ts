import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { computeNextRunAt } from './next-run-at.util';

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
}
