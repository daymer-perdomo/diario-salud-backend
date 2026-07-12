import { Injectable } from '@nestjs/common';
import got from 'got';
import { FetchMethod } from '@prisma/client';
import { HttpFetcher } from './http-fetcher.interface';
import { DomainRateLimiterService } from './domain-rate-limiter.service';

/// Fetch HTTP simple, para todo excepto sitios protegidos por Cloudflare
/// (ver HeadlessBrowserFetcher). Usa un User-Agent de navegador real: la
/// investigacion previa confirmo que varios dominios de gobierno (ej.
/// www.cdc.gov, www.nih.gov) devuelven 403 a clientes sin UA de navegador,
/// no porque el contenido no exista.
@Injectable()
export class SimpleHttpFetcher implements HttpFetcher {
  readonly method = FetchMethod.HTTP_SIMPLE;

  constructor(private readonly rateLimiter: DomainRateLimiterService) {}

  async fetchText(url: string, opts?: { timeoutMs?: number }): Promise<string> {
    await this.rateLimiter.consume(url);

    const response = await got.get(url, {
      timeout: { request: opts?.timeoutMs ?? 20_000 },
      retry: { limit: 2 },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      },
    });

    return response.body;
  }
}
