import { Module } from '@nestjs/common';
import { LLM_SERVICE } from './llm.service.interface';
import { GeminiLlmService } from './gemini-llm.service';
import { LlmBudgetService } from './llm-budget.service';
import { PromptsModule } from '../prompts/prompts.module';

/// Proveedor de IA intercambiable: hoy Gemini, cambiar el useClass aqui
/// (o convertirlo en useFactory segun ConfigService) es el unico punto
/// de codigo a tocar para migrar de proveedor -- ningun otro modulo
/// conoce el SDK/API concreto. LlmBudgetService es independiente del
/// proveedor (rastrea gasto real en USD, no logica de un proveedor
/// especifico) y se exporta tambien para poder mostrarlo en el panel.
/// PromptsModule provee el contenido de los system prompts.
///
/// 2026-07-16: Claude/Anthropic retirado por pedido explicito del
/// usuario (la cuenta de Anthropic se quedo sin credito de facturacion
/// real durante pruebas -- ver incidente documentado en
/// LlmBudgetService.priceForModel). GeminiLlmService ya cubria
/// extractClaims/verifyClaims (verificacion adversarial de
/// GroundingModule) desde antes; ahora cubre tambien scoring/rewrite/
/// compliance, asi que vuelve a haber un solo LLM_SERVICE para todo el
/// pipeline.
@Module({
  imports: [PromptsModule],
  providers: [{ provide: LLM_SERVICE, useClass: GeminiLlmService }, LlmBudgetService],
  exports: [LLM_SERVICE, LlmBudgetService],
})
export class LlmModule {}
