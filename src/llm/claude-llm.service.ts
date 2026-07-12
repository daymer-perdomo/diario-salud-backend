import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LlmService } from './llm.service.interface';
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

const REWRITE_SYSTEM_PROMPT = `Eres un redactor tecnico de EcoFarma para la sección "Diario de la Salud".
Tu unica fuente de verdad es el texto original que te entrega el usuario, proveniente de una
institucion de salud oficial. Reglas estrictas:
- NUNCA agregues un dato (numero, fecha, nombre de medicamento, cifra, entidad) que no este
  literalmente presente en el texto original. Si el original no lo dice, tu tampoco.
- El texto debe ser claro, conciso, factual, neutral, educativo, no promocional y juridicamente
  prudente.
- NUNCA: recomendar un medicamento, dar dosis, dar recomendaciones terapeuticas, incitar a
  comprar, comparar productos, diagnosticar, o parecer un consejo medico personalizado.
- Usa formulaciones como "Segun [fuente]...", "La institucion publico...", "La fuente original
  senala...".
- Por cada afirmacion factual relevante en tu reescritura (numero, fecha, entidad, declaracion),
  registra un claim en la lista "claims" con el fragmento EXACTO del texto original que la
  respalda en supportingSpanInOriginal. Si no encuentras un fragmento que la respalde, pon null
  ahi en vez de inventar uno -- eso sera revisado por un verificador independiente.
Debes responder UNICAMENTE llamando la herramienta "submit_rewrite".`;

const VERIFY_CLAIMS_SYSTEM_PROMPT = `Eres un verificador de hechos esceptico e independiente.
Se te entrega un texto fuente y una lista de afirmaciones (claims) que alguien dice que ese texto
respalda. Tu trabajo es EXCLUSIVAMENTE verificar, contra el texto fuente, si cada afirmacion esta
realmente soportada. No conoces ni te importa de donde vinieron las afirmaciones -- evaluas cada
una de forma independiente y con escepticismo por defecto.
Para cada claim, devuelve:
- SOPORTADA: el texto fuente confirma literalmente la afirmacion.
- PARCIAL: el texto fuente confirma parte de la afirmacion pero no todo, o con matices distintos.
- NO_SOPORTADA: el texto fuente no menciona esto en absoluto, o lo contradice.
Cita la evidencia textual exacta (evidenceQuote) cuando exista, o null si no hay nada relevante.
Ante la duda, prefiere NO_SOPORTADA o PARCIAL sobre SOPORTADA.
Debes responder UNICAMENTE llamando la herramienta "submit_verdicts".`;

const COMPLIANCE_SYSTEM_PROMPT = `Eres un revisor de cumplimiento normativo para contenido de salud
publica. Evalua el texto entregado contra estas reglas -- el texto NUNCA debe:
1. Recomendar un medicamento especifico.
2. Dar instrucciones de dosificacion.
3. Dar recomendaciones terapeuticas.
4. Incitar al lector a comprar un producto.
5. Comparar productos con fines comerciales.
6. Realizar un diagnostico.
7. Parecer un consejo medico personalizado dirigido al lector.
Por cada violacion encontrada, cita el fragmento exacto (excerpt) y explica por que viola la regla.
Si no hay violaciones, passes=true y violations=[].
Debes responder UNICAMENTE llamando la herramienta "submit_compliance_check".`;

const SCORING_SYSTEM_PROMPT = `Eres un clasificador editorial para "Diario de la Salud" de EcoFarma.
Evalua el siguiente item recolectado de una fuente oficial de salud.

Marca isRelevant=false (y explica en relevanceReason) si el contenido es: no relacionado con
salud, una pagina institucional sin valor informativo, una oferta de empleo o proceso de
contratacion, una licitacion o aviso de contratacion publica, contenido excesivamente
tecnico/administrativo sin interes para el publico general, contenido excesivamente politico sin
pertinencia clara de salud publica, o de escaso valor editorial.

Si isRelevant=true, asigna relevanceScore (0 a 1) y un riskLevel segun estos niveles:
- BAJO: prevencion general, campanas oficiales, cifras de salud publica.
- MEDIO: seguridad de productos, vigilancia epidemiologica, dispositivos medicos, temas clinicos
  simplificados.
- ALTO: medicamentos, embarazo, ninos, cancer, tratamientos, retiros de producto, falsificacion.
Si isRelevant=false, riskLevel debe ser null.
Debes responder UNICAMENTE llamando la herramienta "submit_scoring".`;

@Injectable()
export class ClaudeLlmService implements LlmService {
  private readonly logger = new Logger(ClaudeLlmService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') });
    this.model = config.get<string>('ANTHROPIC_MODEL')!;
  }

  async scoreRelevanceAndRisk(input: {
    originalTitle: string;
    originalContent: string;
    sourceInstitution: string;
  }): Promise<ScoringOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: SCORING_SYSTEM_PROMPT,
      userPrompt:
        `Institucion fuente: ${input.sourceInstitution}\n\n` +
        `Titulo:\n${input.originalTitle}\n\n` +
        `Contenido:\n${input.originalContent}`,
      toolName: 'submit_scoring',
      toolDescription: 'Entrega la clasificacion de relevancia y nivel de riesgo.',
      jsonSchema: SCORING_TOOL_JSON_SCHEMA,
      zodSchema: ScoringOutputSchema,
    });
  }

  async rewrite(input: {
    originalTitle: string;
    originalContent: string;
    sourceInstitution: string;
  }): Promise<RewriteOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      userPrompt:
        `Institucion fuente: ${input.sourceInstitution}\n\n` +
        `Titulo original:\n${input.originalTitle}\n\n` +
        `Texto original completo:\n${input.originalContent}`,
      toolName: 'submit_rewrite',
      toolDescription: 'Entrega la reescritura y la lista de claims con su respaldo en el original.',
      jsonSchema: REWRITE_TOOL_JSON_SCHEMA,
      zodSchema: RewriteOutputSchema,
    });
  }

  async verifyClaims(input: {
    originalContent: string;
    claims: Array<{ text: string; type: string; supportingSpanInOriginal: string | null }>;
  }): Promise<VerifyClaimsOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: VERIFY_CLAIMS_SYSTEM_PROMPT,
      userPrompt:
        `Texto fuente:\n${input.originalContent}\n\n` +
        `Afirmaciones a verificar (JSON):\n${JSON.stringify(input.claims, null, 2)}`,
      toolName: 'submit_verdicts',
      toolDescription: 'Entrega el veredicto de soporte para cada claim.',
      jsonSchema: VERIFY_CLAIMS_TOOL_JSON_SCHEMA,
      zodSchema: VerifyClaimsOutputSchema,
    });
  }

  async checkCompliance(input: {
    rewrittenTitle: string;
    rewrittenContent: string;
  }): Promise<ComplianceCheckOutput> {
    return this.callWithStructuredOutput({
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
      userPrompt: `Titulo:\n${input.rewrittenTitle}\n\nCuerpo:\n${input.rewrittenContent}`,
      toolName: 'submit_compliance_check',
      toolDescription: 'Entrega el resultado del chequeo de cumplimiento normativo.',
      jsonSchema: COMPLIANCE_TOOL_JSON_SCHEMA,
      zodSchema: ComplianceCheckOutputSchema,
    });
  }

  /// Fuerza tool_choice sobre una unica herramienta para obtener JSON
  /// estructurado, valida con Zod, y reintenta UNA vez con un mensaje
  /// correctivo si la salida no cumple el schema -- nunca acepta una
  /// salida que no valida silenciosamente.
  private async callWithStructuredOutput<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    toolName: string;
    toolDescription: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodSchema<T>;
  }): Promise<T> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: params.userPrompt }];

    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: params.systemPrompt,
        messages,
        tools: [
          {
            name: params.toolName,
            description: params.toolDescription,
            input_schema: params.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: params.toolName },
      });

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error(`Respuesta de Claude sin tool_use para ${params.toolName}`);
      }

      const parsed = params.zodSchema.safeParse(toolUse.input);
      if (parsed.success) {
        return parsed.data;
      }

      this.logger.warn(
        `Salida de ${params.toolName} no cumple el schema (intento ${attempt}): ${parsed.error.message}`,
      );
      if (attempt === 2) {
        throw new Error(`Claude no produjo una salida valida para ${params.toolName} tras 2 intentos`);
      }

      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Tu ultima respuesta no cumplio el schema esperado: ${parsed.error.message}. Vuelve a llamar la herramienta "${params.toolName}" con una salida que cumpla exactamente el schema.`,
        },
      );
    }

    throw new Error('Unreachable');
  }
}
