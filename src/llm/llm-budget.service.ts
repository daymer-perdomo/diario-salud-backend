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
export class LlmBudgetExceededError extends Error {
  constructor(spentUsd: number, budgetUsd: number) {
    super(
      `Presupuesto de IA agotado: gastado $${spentUsd.toFixed(4)} de un maximo de $${budgetUsd.toFixed(2)} ` +
        `(MAX_LLM_BUDGET_USD). Ninguna llamada nueva a Gemini se ejecuta hasta que se suba el limite.`,
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

  private getBudgetUsd(): number {
    return this.config.get<number>('MAX_LLM_BUDGET_USD') ?? Number.POSITIVE_INFINITY;
  }

  async getCumulativeSpendUsd(): Promise<number> {
    const result = await this.prisma.llmCall.aggregate({ _sum: { costUsd: true } });
    return Number(result._sum.costUsd ?? 0);
  }

  /// Llamar ANTES de cada request a la API de Gemini. Lanza
  /// LlmBudgetExceededError (sin hacer la llamada) si ya se alcanzo el
  /// presupuesto -- el freno actua antes de gastar, no despues.
  async assertWithinBudget(): Promise<void> {
    const budget = this.getBudgetUsd();
    if (!Number.isFinite(budget)) return;

    const spent = await this.getCumulativeSpendUsd();
    if (spent >= budget) {
      throw new LlmBudgetExceededError(spent, budget);
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

    const spent = await this.getCumulativeSpendUsd();
    const budget = this.getBudgetUsd();
    this.logger.log(
      `Llamada a ${params.model} (${params.stage}): ${params.inputTokens} in / ${params.outputTokens} out = ` +
        `$${costUsd.toFixed(4)}. Acumulado: $${spent.toFixed(4)}` +
        (Number.isFinite(budget) ? ` de $${budget.toFixed(2)}` : ''),
    );
    return spent;
  }
}
