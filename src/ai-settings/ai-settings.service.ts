import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { encryptSecret, decryptSecret } from '../common/crypto.util';

export interface AiSettingsPublic {
  model: string | null;
  effectiveModel: string;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  updatedAt: Date | null;
}

/// Fila unica en AiSettings (sin key, a diferencia de PromptTemplate) --
/// model/apiKeyEncrypted en null significa "usa la variable de entorno".
/// GeminiLlmService llama resolveEffective() en CADA llamada a Gemini
/// (sin cache en memoria de proceso) para que cambiar el modelo o rotar
/// la key desde el panel tenga efecto inmediato, sin reiniciar el
/// backend -- mismo principio que ya aplica PromptsService con los
/// prompts.
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  /// Nunca devuelve la API key completa -- solo si hay una guardada y sus
  /// ultimos 4 caracteres, para que el panel pueda mostrar "termina en
  /// ****1234" sin exponer el secreto en cada GET.
  async getPublic(): Promise<AiSettingsPublic> {
    const row = await this.prisma.aiSettings.findFirst();
    const envModel = this.config.get<string>('GEMINI_MODEL')!;
    return {
      model: row?.model ?? null,
      effectiveModel: row?.model || envModel,
      hasApiKey: !!row?.apiKeyEncrypted,
      apiKeyLast4: row?.apiKeyEncrypted ? this.decrypt(row.apiKeyEncrypted).slice(-4) : null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(dto: { model?: string; apiKey?: string }, userId: string): Promise<AiSettingsPublic> {
    const existing = await this.prisma.aiSettings.findFirst();
    const data: { model?: string | null; apiKeyEncrypted?: string | null; updatedById: string } = {
      updatedById: userId,
    };
    if (dto.model !== undefined) {
      data.model = dto.model.trim() || null;
    }
    if (dto.apiKey !== undefined) {
      const trimmed = dto.apiKey.trim();
      data.apiKeyEncrypted = trimmed ? this.encrypt(trimmed) : null;
    }

    const updated = existing
      ? await this.prisma.aiSettings.update({ where: { id: existing.id }, data })
      : await this.prisma.aiSettings.create({ data });

    // Nunca se guarda el valor real de la key en la auditoria, solo si
    // cambio o no -- el registro de auditoria es legible por cualquier
    // ADMIN, no es el lugar para un secreto.
    await this.audit.record({
      entityType: 'AiSettings',
      entityId: updated.id,
      action: 'AI_SETTINGS_UPDATED',
      actorType: ActorType.HUMAN,
      actorId: userId,
      payload: { modelChanged: dto.model !== undefined, apiKeyChanged: dto.apiKey !== undefined },
    });

    return this.getPublic();
  }

  /// Usado por GeminiLlmService antes de cada llamada -- envApiKey/envModel
  /// son GEMINI_API_KEY/GEMINI_MODEL, el fallback si nunca se configuro
  /// nada desde el panel (o si se limpio el override).
  async resolveEffective(envApiKey: string, envModel: string): Promise<{ apiKey: string; model: string }> {
    const row = await this.prisma.aiSettings.findFirst();
    return {
      apiKey: row?.apiKeyEncrypted ? this.decrypt(row.apiKeyEncrypted) : envApiKey,
      model: row?.model || envModel,
    };
  }

  private encrypt(plainText: string): string {
    return encryptSecret(plainText, this.config.get<string>('JWT_SECRET')!);
  }

  private decrypt(stored: string): string {
    return decryptSecret(stored, this.config.get<string>('JWT_SECRET')!);
  }
}
