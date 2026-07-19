import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { buildRedisConnectionOptions } from '../../config/redis-connection.util';

/// Limita la frecuencia de peticiones salientes por dominio, para no ser
/// bloqueados por los sitios de gobierno (varios ya usan Cloudflare/Akamai).
/// Al agotarse el limite lanza un error retryable -- el job de BullMQ lo
/// vuelve a encolar con backoff, en vez de reintentar inmediatamente.
@Injectable()
export class DomainRateLimiterService {
  private readonly logger = new Logger(DomainRateLimiterService.name);
  private readonly limiter: RateLimiterRedis;

  constructor(config: ConfigService) {
    // Bug real encontrado 2026-07-17: con enableOfflineQueue:false, cualquier
    // consume() disparado antes de que ESTA conexion (nueva, propia de este
    // servicio) termine de conectar rechazaba con "Stream isn't writeable"
    // -- y el catch de abajo lo disfrazaba como RATE_LIMITED de verdad,
    // bloqueando TODAS las fuentes en los primeros segundos tras cada
    // arranque del servidor. Se deja el offline queue en su default
    // (true): los comandos se encolan hasta que la conexion este lista en
    // vez de fallar falsamente.
    const redisClient = new Redis(buildRedisConnectionOptions(config));

    // Bug real encontrado 2026-07-17 (reportado por el usuario: imagen de
    // un articulo de PAHO nunca se obtuvo): con points:3/duration:5, el
    // patron normal de UNA corrida (1 fetch del feed/listado + hasta 3
    // fetches de enriquecimiento, uno por item nuevo -- imagen de detalle
    // en HtmlScraperAdapter, og:image en RssAdapter, texto de PDF en
    // INVIMA) YA SON 4 peticiones al mismo host, superando el limite
    // antes de terminar. Verificado en logs de una sola corrida: 5
    // RATE_LIMITED distintos (3 PDFs de INVIMA, 1 imagen de ADRES, 1
    // og:image de PAHO) -- nos estabamos autobloqueando, no era el sitio
    // externo. points:10/duration:10 (~1 req/s en promedio, rafaga de
    // hasta 10) cubre con margen el caso normal (1 + 3 = 4) y tambien
    // "Buscar otras 3" (1 + 6 = 7), sin dejar de ser un ritmo respetuoso.
    this.limiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'domain-rl',
      points: 10,
      duration: 10,
    });
  }

  async consume(url: string): Promise<void> {
    const host = new URL(url).host;
    try {
      await this.limiter.consume(host, 1);
    } catch (err) {
      // Solo un RateLimiterRes es un rechazo real por limite de tasa --
      // cualquier otro error (conexion a Redis, etc) es un fallo de
      // infraestructura y NO debe disfrazarse de rate limit, o se oculta
      // el problema real (ver bug de arriba).
      if (err instanceof RateLimiterRes) {
        throw new Error(`RATE_LIMITED:${host}`);
      }
      this.logger.error(`Fallo real del rate limiter (no es un rechazo por cuota) para ${host}: ${(err as Error).message}`);
      throw err;
    }
  }
}
