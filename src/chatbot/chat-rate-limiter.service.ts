import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { buildRedisConnectionOptions } from '../config/redis-connection.util';

export class ChatRateLimitedError extends Error {
  constructor(scope: 'session' | 'ip') {
    super(`RATE_LIMITED:${scope}`);
    this.name = 'ChatRateLimitedError';
  }
}

/// Unico endpoint sin login de todo el backend (ver ChatbotController) --
/// sin este freno, un script que golpee /chatbot/message sin parar
/// consumiria presupuesto de Gemini sin limite (ver LlmBudgetService
/// domainForStage) y llenaria Postgres de ChatSession/ChatMessage.
/// Mismo patron que DomainRateLimiterService (rate-limiter-flexible +
/// ioredis), pero limitando ENTRADA de clientes, no salida hacia
/// fuentes externas.
@Injectable()
export class ChatRateLimiterService {
  private readonly logger = new Logger(ChatRateLimiterService.name);
  private readonly bySession: RateLimiterRedis;
  private readonly byIp: RateLimiterRedis;

  constructor(config: ConfigService) {
    const redisClient = new Redis(buildRedisConnectionOptions(config));
    // Una sesion real de chat no manda mas de unos pocos mensajes por
    // minuto -- 30 en 10 minutos deja margen amplio para una conversacion
    // normal y corta un loop automatizado.
    this.bySession = new RateLimiterRedis({ storeClient: redisClient, keyPrefix: 'chat-rl-session', points: 30, duration: 600 });
    // Mas generoso que el limite por sesion: cubre a alguien que abre
    // varias conversaciones nuevas (recarga la pagina, borra localStorage).
    this.byIp = new RateLimiterRedis({ storeClient: redisClient, keyPrefix: 'chat-rl-ip', points: 60, duration: 3600 });
  }

  async assertWithinLimit(sessionId: string, ipHash: string): Promise<void> {
    await this.consumeOrThrow(this.bySession, sessionId, 'session');
    await this.consumeOrThrow(this.byIp, ipHash, 'ip');
  }

  private async consumeOrThrow(limiter: RateLimiterRedis, key: string, scope: 'session' | 'ip'): Promise<void> {
    try {
      await limiter.consume(key, 1);
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        throw new ChatRateLimitedError(scope);
      }
      this.logger.error(`Fallo real del rate limiter del chatbot (no es un rechazo por cuota, scope=${scope}): ${(err as Error).message}`);
      throw err;
    }
  }
}
