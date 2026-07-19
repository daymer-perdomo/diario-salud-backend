import { Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, PromptKey, PromptTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { DEFAULT_PROMPTS } from './default-prompts';

/// Unica fuente de verdad de los system prompts que GeminiLlmService le
/// envia a Gemini -- ver el comentario en default-prompts.ts sobre por
/// que el contenido en runtime SIEMPRE sale de la base de datos, nunca
/// de una constante en el codigo.
@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  findAll(): Promise<PromptTemplate[]> {
    return this.prisma.promptTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  /// Usado por GeminiLlmService antes de cada llamada a Gemini. Si falta
  /// la fila (no deberia pasar tras el seed) se falla fuerte en vez de
  /// caer de vuelta a un default hardcodeado -- silenciar esto ocultaria
  /// justo el bug que se queria evitar al sacar los prompts del codigo.
  async getContent(key: PromptKey): Promise<string> {
    const row = await this.prisma.promptTemplate.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(
        `No hay prompt sembrado para ${key} -- corre el seed (prisma/seed.ts) antes de usar el pipeline de IA.`,
      );
    }
    return row.content;
  }

  async update(key: PromptKey, content: string, userId: string): Promise<PromptTemplate> {
    const before = await this.prisma.promptTemplate.findUnique({ where: { key } });
    const updated = await this.prisma.promptTemplate.update({
      where: { key },
      data: { content, updatedById: userId },
    });
    await this.audit.record({
      entityType: 'PromptTemplate',
      entityId: updated.id,
      action: 'PROMPT_UPDATED',
      actorType: ActorType.HUMAN,
      actorId: userId,
      payload: { key, previousContent: before?.content, newContent: content },
    });
    return updated;
  }

  /// Solo crea filas que no existan todavia -- nunca pisa un prompt ya
  /// editado por un ADMIN. Llamado desde prisma/seed.ts.
  async seedDefaults(): Promise<void> {
    for (const key of Object.values(PromptKey)) {
      await this.prisma.promptTemplate.upsert({
        where: { key },
        update: {},
        create: { key, content: DEFAULT_PROMPTS[key] },
      });
    }
  }
}
