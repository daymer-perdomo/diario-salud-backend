import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

/// Limita la frecuencia de peticiones salientes por dominio, para no ser
/// bloqueados por los sitios de gobierno (varios ya usan Cloudflare/Akamai).
/// Al agotarse el limite lanza un error retryable -- el job de BullMQ lo
/// vuelve a encolar con backoff, en vez de reintentar inmediatamente.
@Injectable()
export class DomainRateLimiterService {
  private readonly limiter: RateLimiterRedis;

  constructor(config: ConfigService) {
    const redisClient = new Redis({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      enableOfflineQueue: false,
    });

    this.limiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'domain-rl',
      points: 3,
      duration: 5,
    });
  }

  async consume(url: string): Promise<void> {
    const host = new URL(url).host;
    try {
      await this.limiter.consume(host, 1);
    } catch {
      throw new Error(`RATE_LIMITED:${host}`);
    }
  }
}
