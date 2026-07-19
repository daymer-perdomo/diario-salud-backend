import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),

  /// Connection string unico (ej. Render Key Value: "redis://user:pass@host:port").
  /// Si esta presente tiene prioridad sobre REDIS_HOST/PORT/PASSWORD --
  /// ver buildRedisConnectionOptions. Local (Homebrew) sigue usando los
  /// tres campos separados, sin necesidad de REDIS_URL.
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_SECRET: z.string().min(8, 'JWT_SECRET debe tener al menos 8 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  /// Clave estatica para la API publica de solo lectura de articulos
  /// aprobados (ver ArticlesController) -- distinta del JWT porque la
  /// consume un sistema externo, no un usuario con cuenta.
  PUBLIC_API_KEY: z.string().min(16, 'PUBLIC_API_KEY debe tener al menos 16 caracteres'),

  /// Unico proveedor de IA del pipeline -- ver comentario en LlmModule
  /// sobre por que Claude/Anthropic se retiro el 2026-07-16.
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),

  /// Tope de articulos EVALUADO que RewriteSelectionService encola a
  /// rewrite por corrida de seleccion. Ver comentario de RewriteSelectionService
  /// -- es el freno principal contra otro agotamiento de credito como el
  /// del 2026-07-12 (ver rss.adapter.ts): Scoring ya NO encola a rewrite
  /// automaticamente, solo este paso lo hace, acotado a este numero.
  DAILY_REWRITE_LIMIT: z.coerce.number().int().positive().default(5),

  /// Piso de calidad para RewriteSelectionService: un articulo EVALUADO
  /// solo avanza a rewrite/grounding/compliance si su relevanceScore
  /// (0-1, asignado por Scoring) es >= este valor, ADEMAS de estar entre
  /// los mejores DAILY_REWRITE_LIMIT. Si ningun EVALUADO lo alcanza ese
  /// dia, no se selecciona nada -- no se "rellena la cuota" con contenido
  /// de baja calidad solo para completar 5.
  MIN_RELEVANCE_SCORE_FOR_REWRITE: z.coerce.number().min(0).max(1).default(0.5),

  /// Presupuesto maximo REAL en USD para llamadas a la API de Gemini
  /// (ver LlmBudgetService) -- pedido explicito del usuario 2026-07-16.
  /// Se mide con los tokens reales que la API reporta en cada respuesta,
  /// no una estimacion. Sin definir = sin limite (Infinity).
  MAX_LLM_BUDGET_USD: z.coerce.number().positive().optional(),

  PORT: z.coerce.number().int().positive().default(3000),
  /// 'staging' es un ambiente real y distinto de 'production' -- probar
  /// cambios de pipeline/schema contra una base de datos separada antes
  /// de tocar la de produccion. Ver render.yaml (bloque
  /// "diario-salud-backend-staging").
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/// Usado por @nestjs/config como funcion `validate`: si falta o esta mal
/// tipada cualquier variable critica, la app falla al arrancar en vez de
/// arrancar en un estado a medias (p.ej. sin JWT_SECRET real).
export function validateEnv(rawConfig: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion de entorno invalida:\n${details}`);
  }
  return parsed.data;
}
