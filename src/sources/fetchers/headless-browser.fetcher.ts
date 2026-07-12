import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { FetchMethod } from '@prisma/client';
import { HttpFetcher } from './http-fetcher.interface';
import { DomainRateLimiterService } from './domain-rate-limiter.service';

/// Solo para fuentes protegidas por Cloudflare/JS-challenge (ej.
/// cancer.gov.co, confirmado en la investigacion previa que bloquea fetch
/// HTTP simple con 403). Recomendado correr el worker que use este fetcher
/// como un deployable aparte (ver src/scraper-worker.ts) para que el uso de
/// memoria/CPU de Chromium headless no afecte la latencia del API principal.
@Injectable()
export class HeadlessBrowserFetcher implements HttpFetcher, OnModuleDestroy {
  readonly method = FetchMethod.HEADLESS_BROWSER;
  private readonly logger = new Logger(HeadlessBrowserFetcher.name);
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly rateLimiter: DomainRateLimiterService) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: true });
    }
    return this.browserPromise;
  }

  async fetchText(url: string, opts?: { timeoutMs?: number }): Promise<string> {
    await this.rateLimiter.consume(url);

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'es-CO',
    });

    try {
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: opts?.timeoutMs ?? 30_000,
      });
      return await page.content();
    } finally {
      await context.close();
    }
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close().catch((err) => this.logger.warn(`Error cerrando Chromium: ${err}`));
    }
  }
}
