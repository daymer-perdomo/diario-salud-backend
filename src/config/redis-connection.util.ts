import { ConfigService } from '@nestjs/config';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, never>;
}

/// Render (y otros proveedores administrados) entregan un unico
/// connection string (REDIS_URL, ej. "redis://user:pass@host:6379" o
/// "rediss://..." para TLS) en vez de host/puerto/password separados.
/// En local (Homebrew) seguimos usando REDIS_HOST/REDIS_PORT/REDIS_PASSWORD
/// tal como ya estaba -- REDIS_URL tiene prioridad si esta presente, para
/// no romper ningun entorno existente.
export function buildRedisConnectionOptions(config: ConfigService): RedisConnectionOptions {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }

  return {
    host: config.get<string>('REDIS_HOST') ?? 'localhost',
    port: config.get<number>('REDIS_PORT') ?? 6379,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
  };
}
