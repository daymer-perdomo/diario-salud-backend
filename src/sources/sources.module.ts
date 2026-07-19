import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SourcesService } from './sources.service';
import { SourceRegistryService } from './source-registry.service';
import { SourcesController } from './sources.controller';
import { SOURCE_ADAPTERS } from './interfaces/source-adapter.interface';
import { RssAdapter } from './adapters/rss.adapter';
import { OpenDataApiAdapter } from './adapters/open-data-api.adapter';
import { HtmlScraperAdapter } from './adapters/html-scraper.adapter';
import { AdapterFactory } from './adapters/adapter.factory';
import { HTTP_FETCHERS } from './fetchers/http-fetcher.interface';
import { SimpleHttpFetcher } from './fetchers/simple-http.fetcher';
import { HeadlessBrowserFetcher } from './fetchers/headless-browser.fetcher';
import { HttpFetcherFactory } from './fetchers/http-fetcher.factory';
import { DomainRateLimiterService } from './fetchers/domain-rate-limiter.service';
import { ArticleImageBackfillService } from './article-image-backfill.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SourcesController],
  providers: [
    SourcesService,
    SourceRegistryService,
    DomainRateLimiterService,
    SimpleHttpFetcher,
    HeadlessBrowserFetcher,
    { provide: HTTP_FETCHERS, useFactory: (a: SimpleHttpFetcher, b: HeadlessBrowserFetcher) => [a, b], inject: [SimpleHttpFetcher, HeadlessBrowserFetcher] },
    HttpFetcherFactory,
    RssAdapter,
    OpenDataApiAdapter,
    HtmlScraperAdapter,
    { provide: SOURCE_ADAPTERS, useFactory: (a: RssAdapter, b: OpenDataApiAdapter, c: HtmlScraperAdapter) => [a, b, c], inject: [RssAdapter, OpenDataApiAdapter, HtmlScraperAdapter] },
    AdapterFactory,
    ArticleImageBackfillService,
  ],
  exports: [SourcesService, SourceRegistryService, AdapterFactory, HttpFetcherFactory],
})
export class SourcesModule {}
