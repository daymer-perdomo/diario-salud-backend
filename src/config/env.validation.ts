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

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  WORDPRESS_BASE_URL: z.string().url(),
  WORDPRESS_APP_USERNAME: z.string().optional().default(''),
  WORDPRESS_APP_PASSWORD: z.string().optional().default(''),
  WORDPRESS_DIARIO_SALUD_CATEGORY_ID: z.coerce.number().int().optional(),

  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
