import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptKey } from '@prisma/client';
import { z } from 'zod';
import { LlmService } from './llm.service.interface';
import { LlmBudgetService } from './llm-budget.service';
import { PromptsService } from '../prompts/prompts.service';
import { AiSettingsService } from '../ai-settings/ai-settings.service';
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
import { ChatIntentOutput, ChatIntentSchema, CHAT_INTENT_TOOL_JSON_SCHEMA } from './schemas/chat-intent.schema';
import { ChatReplyOutput, ChatReplyOutputSchema, CHAT_REPLY_TOOL_JSON_SCHEMA } from './schemas/chat-reply.schema';
import {
  SearchCorrectionOutput,
  SearchCorrectionSchema,
  SEARCH_CORRECTION_TOOL_JSON_SCHEMA,
} from './schemas/search-correction.schema';

/// Tope de espera por llamada a la API de Gemini -- sin esto un pico de
/// lentitud puntual de Gemini se propaga tal cual al cliente (caso real
/// 2026-08-09, ver comentario junto al `fetch` mas abajo).
const GEMINI_REQUEST_TIMEOUT_MS = 20_000;

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
  /// Fallback si nunca se configuro nada desde el panel (o si se limpio
  /// el override) -- ver AiSettingsService.resolveEffective, llamado en
  /// CADA llamada a Gemini mas abajo. Ya no son el valor final: solo el
  /// piso de la variable de entorno.
  private readonly envApiKey: string;
  private readonly envModel: string;

  constructor(
    config: ConfigService,
    private readonly budget: LlmBudgetService,
    private readonly prompts: PromptsService,
    private readonly aiSettings: AiSettingsService,
  ) {
    this.envApiKey = config.get<string>('GEMINI_API_KEY')!;
    this.envModel = config.get<string>('GEMINI_MODEL')!;
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

  /// `stage` con prefijo `chat_` a proposito -- es lo que LlmBudgetService
  /// (domainForStage) usa para aislar el presupuesto del chatbot publico
  /// del presupuesto del pipeline editorial (ver plan
  /// kind-giggling-cerf.md, Fase 0).
  async extractChatIntent(input: {
    message: string;
    history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>;
  }): Promise<ChatIntentOutput> {
    const historyText = input.history.length
      ? input.history.map((h) => `${h.role === 'USER' ? 'Cliente' : 'Asistente'}: ${h.content}`).join('\n')
      : '(sin turnos previos)';
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.CHAT_INTENT_EXTRACTION),
      userPrompt: `Turnos previos:\n${historyText}\n\nMensaje del cliente:\n${input.message}`,
      stage: 'chat_extract_intent',
      jsonSchema: CHAT_INTENT_TOOL_JSON_SCHEMA,
      zodSchema: ChatIntentSchema,
      maxOutputTokens: 512,
    });
  }

  /// `facts` es SIEMPRE lo que InventoryService ya consulto de Postgres
  /// (ver ChatbotService) -- nunca se le pide al modelo que "sepa" stock o
  /// precio por su cuenta, solo que redacte a partir de este JSON.
  async composeChatReply(input: { message: string; facts: unknown }): Promise<ChatReplyOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.CHAT_REPLY_COMPOSITION),
      userPrompt: `Mensaje del cliente:\n${input.message}\n\nHechos consultados en la base de datos (JSON):\n${JSON.stringify(input.facts)}`,
      stage: 'chat_compose_reply',
      jsonSchema: CHAT_REPLY_TOOL_JSON_SCHEMA,
      zodSchema: ChatReplyOutputSchema,
      maxOutputTokens: 1024,
    });
  }

  /// stage 'chat_' -- mismo dominio de presupuesto que el resto del
  /// chatbot (ver LlmBudgetService.domainForStage). Solo se llama cuando
  /// la busqueda literal ya fallo (ver ChatbotService.gatherFacts), asi
  /// que el costo adicional queda acotado a los casos que de verdad lo
  /// necesitan.
  async suggestAlternativeSearchTerms(input: { query: string }): Promise<SearchCorrectionOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: await this.prompts.getContent(PromptKey.CHAT_SEARCH_CORRECTION),
      userPrompt: `Termino de busqueda que no encontro nada:\n${input.query}`,
      stage: 'chat_search_correction',
      jsonSchema: SEARCH_CORRECTION_TOOL_JSON_SCHEMA,
      zodSchema: SearchCorrectionSchema,
      maxOutputTokens: 256,
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
    // Resuelto una vez por llamada (no cacheado en memoria de proceso):
    // si un ADMIN cambia el modelo o rota la key desde el panel, la
    // SIGUIENTE llamada ya lo usa, sin reiniciar el backend -- ver
    // AiSettingsService.resolveEffective.
    const { apiKey, model } = await this.aiSettings.resolveEffective(this.envApiKey, this.envModel);

    for (let attempt = 1; attempt <= 2; attempt++) {
      // Bloquea ANTES de gastar, no despues -- ver comentario de
      // LlmBudgetService sobre el pedido del usuario (2026-07-16) de un
      // presupuesto maximo real en USD (MAX_LLM_BUDGET_USD).
      await this.budget.assertWithinBudget(params.stage);

      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
            // Sin esto, un `fetch` sin `signal` no tiene limite propio y un
            // colgue puntual de la API de Gemini se propaga tal cual al
            // cliente -- caso real 2026-08-09, el chatbot en produccion
            // quedo en "Escribiendo..." 134s con una consulta que la
            // segunda vez tardo 3s (no era un bug del codigo, la API
            // simplemente tuvo un pico de lentitud). GEMINI_REQUEST_TIMEOUT_MS
            // acota el peor caso a un error rapido en vez de una espera
            // indefinida.
            signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
          },
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new Error(`Gemini no respondio en ${GEMINI_REQUEST_TIMEOUT_MS / 1000}s para ${params.stage}`);
        }
        throw err;
      }

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
        model,
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
