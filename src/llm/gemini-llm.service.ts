import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptKey } from '@prisma/client';
import { z } from 'zod';
import { LlmService } from './llm.service.interface';
import { LlmBudgetService } from './llm-budget.service';
import { PromptsService } from '../prompts/prompts.service';
import { toGeminiSchema } from './gemini-schema.util';
import { RewriteOutput, RewriteOutputSchema, REWRITE_TOOL_JSON_SCHEMA } from './schemas/rewrite.schema';
import {
  VerifyClaimsOutput,
  VerifyClaimsOutputSchema,
  VERIFY_CLAIMS_TOOL_JSON_SCHEMA,
} from './schemas/verify-claims.schema';
import {
  ComplianceCheckOutput,
  ComplianceCheckOutputSchema,
  COMPLIANCE_TOOL_JSON_SCHEMA,
} from './schemas/compliance.schema';
import { ScoringOutput, ScoringOutputSchema, SCORING_TOOL_JSON_SCHEMA } from './schemas/scoring.schema';
import {
  ExtractClaimsOutput,
  ExtractClaimsOutputSchema,
  EXTRACT_CLAIMS_TOOL_JSON_SCHEMA,
} from './schemas/extract-claims.schema';

/// Unico proveedor de IA del pipeline (2026-07-16: Claude retirado por
/// pedido explicito del usuario, cuenta de Anthropic sin credito --
/// ver LlmBudgetService.priceForModel). Usa responseSchema nativo de
/// Gemini (fuerza el JSON exacto en la propia generacion, ver
/// gemini-schema.util) en vez del patron tool_choice+reintento que
/// tenia ClaudeLlmService -- igual se valida con Zod antes de confiar en
/// el resultado, nunca se acepta JSON sin validar solo porque el
/// proveedor "deberia" cumplir el schema.
@Injectable()
export class GeminiLlmService implements LlmService {
  private readonly logger = new Logger(GeminiLlmService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService, private readonly budget: LlmBudgetService, private readonly prompts: PromptsService) {
    this.apiKey = config.get<string>('GEMINI_API_KEY')!;
    this.model = config.get<string>('GEMINI_MODEL')!;
  }

  async scoreRelevanceAndRisk(input: {
    originalTitle: string;
    originalContent: string;
    sourceInstitution: string;
  }): Promise<ScoringOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.SCORING),
      userPrompt:
        `Institucion fuente: ${input.sourceInstitution}\n\n` +
        `Titulo:\n${input.originalTitle}\n\n` +
        `Contenido:\n${input.originalContent}`,
      stage: 'submit_scoring',
      jsonSchema: SCORING_TOOL_JSON_SCHEMA,
      zodSchema: ScoringOutputSchema,
      maxOutputTokens: 1024,
    });
  }

  async rewrite(input: {
    originalTitle: string;
    originalContent: string;
    sourceInstitution: string;
  }): Promise<RewriteOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.REWRITE),
      userPrompt:
        `Institucion fuente: ${input.sourceInstitution}\n\n` +
        `Titulo original:\n${input.originalTitle}\n\n` +
        `Texto original completo:\n${input.originalContent}`,
      stage: 'submit_rewrite',
      jsonSchema: REWRITE_TOOL_JSON_SCHEMA,
      zodSchema: RewriteOutputSchema,
      maxOutputTokens: 8192,
    });
  }

  async verifyClaims(input: {
    originalContent: string;
    claims: Array<{ text: string; type: string; supportingSpanInOriginal: string | null }>;
  }): Promise<VerifyClaimsOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.VERIFY_CLAIMS),
      userPrompt:
        `Texto fuente:\n${input.originalContent}\n\n` +
        `Afirmaciones a verificar (JSON):\n${JSON.stringify(input.claims, null, 2)}`,
      stage: 'submit_verdicts',
      jsonSchema: VERIFY_CLAIMS_TOOL_JSON_SCHEMA,
      zodSchema: VerifyClaimsOutputSchema,
      maxOutputTokens: 8192,
    });
  }

  async extractClaims(input: { rewrittenText: string }): Promise<ExtractClaimsOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.EXTRACT_CLAIMS),
      userPrompt: `Texto a auditar:\n${input.rewrittenText}`,
      stage: 'extract_claims',
      jsonSchema: EXTRACT_CLAIMS_TOOL_JSON_SCHEMA,
      zodSchema: ExtractClaimsOutputSchema,
      maxOutputTokens: 8192,
    });
  }

  async checkCompliance(input: { rewrittenTitle: string; rewrittenContent: string }): Promise<ComplianceCheckOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.COMPLIANCE),
      userPrompt: `Titulo:\n${input.rewrittenTitle}\n\nCuerpo:\n${input.rewrittenContent}`,
      stage: 'submit_compliance_check',
      jsonSchema: COMPLIANCE_TOOL_JSON_SCHEMA,
      zodSchema: ComplianceCheckOutputSchema,
      maxOutputTokens: 2048,
    });
  }

  /// Valida con Zod y reintenta UNA vez con un mensaje correctivo si la
  /// salida no cumple -- responseSchema baja la probabilidad de esto pero
  /// no la elimina (el modelo puede igual devolver un enum fuera de rango,
  /// texto no-JSON si finishReason no es STOP, etc).
  private async callWithStructuredOutput<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    stage: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodSchema<T>;
    maxOutputTokens: number;
    /// Tope de tokens de "thinking" -- 0 los apaga por completo. Bug real
    /// encontrado 2026-07-17: sin esto, Gemini 2.5 Flash gasta thinking
    /// por defecto y lo factura como output ($2.5/M) sin que aparezca en
    /// el JSON de respuesta -- se midieron llamadas de scoring/extraccion
    /// con 900-5900 tokens de salida para un JSON que pesa una fraccion
    /// de eso. Default 0: las 5 etapas de este pipeline son clasificacion/
    /// extraccion/verificacion estructurada contra un schema fijo, no
    /// razonamiento abierto -- no deberian necesitarlo.
    thinkingBudget?: number;
  }): Promise<T> {
    const responseSchema = toGeminiSchema(params.jsonSchema);
    const contents = [{ role: 'user', parts: [{ text: params.userPrompt }] }];

    for (let attempt = 1; attempt <= 2; attempt++) {
      // Bloquea ANTES de gastar, no despues -- ver comentario de
      // LlmBudgetService sobre el pedido del usuario (2026-07-16) de un
      // presupuesto maximo real en USD (MAX_LLM_BUDGET_USD).
      await this.budget.assertWithinBudget();

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: params.systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema,
              maxOutputTokens: params.maxOutputTokens,
              thinkingConfig: { thinkingBudget: params.thinkingBudget ?? 0 },
            },
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}) en ${params.stage}: ${errorBody}`);
      }

      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      };

      const usage = body.usageMetadata;
      await this.budget.recordUsage({
        stage: params.stage,
        model: this.model,
        inputTokens: usage?.promptTokenCount ?? 0,
        // thoughtsTokenCount va incluido en el precio de output de Gemini
        // (ver LlmBudgetService.priceForModel) pero NO en candidatesTokenCount
        // -- hay que sumarlo aparte para no subestimar el gasto real.
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      });

      const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        const finishReason = body.candidates?.[0]?.finishReason ?? 'desconocido';
        this.logger.warn(`Respuesta de Gemini sin texto para ${params.stage} (intento ${attempt}, finishReason: ${finishReason})`);
        if (attempt === 2) {
          throw new Error(`Gemini no produjo texto para ${params.stage} tras 2 intentos (finishReason: ${finishReason})`);
        }
        continue;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch (err) {
        this.logger.warn(`Salida de ${params.stage} no es JSON valido (intento ${attempt}): ${(err as Error).message}`);
        if (attempt === 2) {
          throw new Error(`Gemini no produjo JSON valido para ${params.stage} tras 2 intentos`);
        }
        continue;
      }

      const parsed = params.zodSchema.safeParse(parsedJson);
      if (parsed.success) {
        return parsed.data;
      }

      this.logger.warn(`Salida de ${params.stage} no cumple el schema (intento ${attempt}): ${parsed.error.message}`);
      if (attempt === 2) {
        throw new Error(`Gemini no produjo una salida valida para ${params.stage} tras 2 intentos`);
      }
    }

    throw new Error('Unreachable');
  }
}
