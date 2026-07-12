import { Module } from '@nestjs/common';
import { LLM_SERVICE } from './llm.service.interface';
import { ClaudeLlmService } from './claude-llm.service';

/// Proveedor de IA intercambiable: hoy Claude, cambiar el useClass aqui
/// (o convertirlo en useFactory segun ConfigService) es el unico punto
/// de codigo a tocar para migrar de proveedor -- ningun otro modulo
/// conoce el SDK concreto.
@Module({
  providers: [{ provide: LLM_SERVICE, useClass: ClaudeLlmService }],
  exports: [LLM_SERVICE],
})
export class LlmModule {}
