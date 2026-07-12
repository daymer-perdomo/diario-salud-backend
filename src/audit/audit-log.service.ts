import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Cliente de Prisma restringido al contexto de una transaccion
/// ($transaction(async (tx) => ...)). Se usa para que un registro de
/// auditoria pueda escribirse en la MISMA transaccion que el cambio de
/// estado que describe (invariante 5 del plan de arquitectura): nunca
/// puede existir una transicion de estado sin su fila de auditoria.
export type TransactionClient = Prisma.TransactionClient;

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actorType: ActorType;
  actorId?: string;
  fromState?: string;
  toState?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /// Solo-anexo por diseno: no se expone ningun metodo update/delete.
  /// El rol de base de datos usado por la app debe ademas carecer de
  /// privilegios UPDATE/DELETE sobre audit_logs a nivel de Postgres.
  async record(entry: AuditEntry, tx?: TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId,
        fromState: entry.fromState,
        toState: entry.toState,
        payload: entry.payload as Prisma.InputJsonValue,
      },
    });
  }
}
