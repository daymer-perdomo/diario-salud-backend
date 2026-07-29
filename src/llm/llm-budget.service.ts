import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/// Freno de gasto real: MAX_LLM_BUDGET_USD (2026-07-16, pedido por el
/// usuario: "tenemos un maximo de 5 usd presupuesto"). A diferencia de
/// los topes de ARTICULOS (DAILY_REWRITE_LIMIT, MIN_RELEVANCE_SCORE_FOR_REWRITE),
/// que acotan CUANTOS articulos entran al pipeline, esto acota el GASTO
/// REAL en dolares medido directamente de `usageMetadata` de cada
/// llamada -- no una estimacion previa. GeminiLlmService llama
/// assertWithinBudget() ANTES de cada llamada a la API (bloquea antes de
/// gastar, no despues) y recordUsage() DESPUES de cada llamada exitosa
/// (con los tokens reales que Gemini reporto).
export type LlmBudgetDomain = 'pipeline' | 'chatbot';

/// Un stage de chatbot (extractChatIntent/composeChatReply) siempre
/// arranca con "chat_" (ver GeminiLlmService) -- todo lo demas es el
/// pipeline editorial existente. Nuevo llamador = agregar su propio
/// prefijo aca si alguna vez necesita su propio techo.
export function domainForStage(stage: string): LlmBudgetDomain {
  return stage.startsWith('chat_') ? 'chatbot' : 'pipeline';
}

const BUDGET_ENV_VAR: Record<LlmBudgetDomain, string> = {
  pipeline: 'MAX_LLM_BUDGET_USD',
  chatbot: 'MAX_LLM_BUDGET_CHATBOT_USD',
};

export class LlmBudgetExceededError extends Error {
  constructor(domain: LlmBudgetDomain, spentUsd: number, budgetUsd: number) {
    super(
      `Presupuesto de IA (${domain}) agotado: gastado $${spentUsd.toFixed(4)} de un maximo de $${budgetUsd.toFixed(2)} ` +
        `(${BUDGET_ENV_VAR[domain]}). Ninguna llamada nueva a Gemini de este dominio se ejecuta hasta que se suba el limite.`,
    );
    this.name = 'LlmBudgetExceededError';
  }
}

/// Precios oficiales por millon de tokens (input/output), verificados en
/// ai.google.dev/gemini-api/docs/pricing. El thinking va incluido en el
/// precio de output, no se cobra aparte (ver GeminiLlmService:
/// thoughtsTokenCount se suma a candidatesTokenCount antes de llamar
/// recordUsage). Modelo desconocido = fallback conservador (la tarifa
/// Flash mas cara conocida) para nunca SUBESTIMAR gasto.
///
/// 2026-07-16: Claude/Anthropic retirado (pedido explicito del usuario
/// tras quedarse la cuenta sin credito de facturacion) -- ver LlmModule.
/// 2026-07-17: la API key de Gemini cambio a un proyecto donde 2.0/2.5
/// (flash y flash-lite) devuelven 404 "no longer available to new users"
/// -- verificado en vivo. GEMINI_MODEL paso a gemini-3.1-flash-lite
/// (precio confirmado igual al de 3-flash-preview: $0.25/$1.50).
/// Se dejan las tarifas 2.5 por si se vuelve a usar esa key/proyecto.
interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

function priceForModel(model: string, logger: Logger): ModelPricing {
  if (model.startsWith('gemini-3.1-flash-lite') || model.startsWith('gemini-3-flash')) {
    return { inputPerMillion: 0.25, outputPerMillion: 1.5 };
  }
  if (model.startsWith('gemini-2.5-flash-lite')) {
    return { inputPerMillion: 0.1, outputPerMillion: 0.4 };
  }
  if (model.startsWith('gemini-2.5-flash') || model.startsWith('gemini-2.0-flash') || model.startsWith('gemini-flash-latest')) {
    return { inputPerMillion: 0.3, outputPerMillion: 2.5 };
  }
  logger.warn(
    `Precio desconocido para el modelo "${model}" -- usando fallback conservador (tarifa Flash mas cara conocida) para no subestimar el gasto real.`,
  );
  return { inputPerMillion: 0.3, outputPerMillion: 2.5 };
}

@Injectable()
export class LlmBudgetService {
  private readonly logger = new Logger(LlmBudgetService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private getBudgetUsd(domain: LlmBudgetDomain): number {
    return this.config.get<number>(BUDGET_ENV_VAR[domain]) ?? Number.POSITIVE_INFINITY;
  }

  async getCumulativeSpendUsd(domain: LlmBudgetDomain): Promise<number> {
    const stageFilter = domain === 'chatbot' ? { startsWith: 'chat_' } : { not: { startsWith: 'chat_' } };
    const result = await this.prisma.llmCall.aggregate({
      where: { stage: stageFilter },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }

  /// Llamar ANTES de cada request a la API de Gemini, con el `stage` que
  /// se va a usar. Lanza LlmBudgetExceededError (sin hacer la llamada) si
  /// el dominio de ese stage (ver domainForStage) ya alcanzo su
  /// presupuesto -- el freno actua antes de gastar, no despues, y esta
  /// aislado por dominio para que un consumidor no pueda tumbar al otro.
  async assertWithinBudget(stage: string): Promise<void> {
    const domain = domainForStage(stage);
    const budget = this.getBudgetUsd(domain);
    if (!Number.isFinite(budget)) return;

    const spent = await this.getCumulativeSpendUsd(domain);
    if (spent >= budget) {
      throw new LlmBudgetExceededError(domain, spent, budget);
    }
  }

  /// Llamar DESPUES de cada request exitoso, con los tokens reales de
  /// `response.usage` -- nunca una estimacion previa a la llamada.
  async recordUsage(params: { stage: string; model: string; inputTokens: number; outputTokens: number }): Promise<number> {
    const pricing = priceForModel(params.model, this.logger);
    const costUsd =
      (params.inputTokens / 1_000_000) * pricing.inputPerMillion +
      (params.outputTokens / 1_000_000) * pricing.outputPerMillion;

    await this.prisma.llmCall.create({
      data: {
        stage: params.stage,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        costUsd,
      },
    });

    const domain = domainForStage(params.stage);
    const spent = await this.getCumulativeSpendUsd(domain);
    const budget = this.getBudgetUsd(domain);
    this.logger.log(
      `Llamada a ${params.model} (${params.stage}, dominio ${domain}): ${params.inputTokens} in / ${params.outputTokens} out = ` +
        `$${costUsd.toFixed(4)}. Acumulado ${domain}: $${spent.toFixed(4)}` +
        (Number.isFinite(budget) ? ` de $${budget.toFixed(2)}` : ''),
    );
    return spent;
  }
}
