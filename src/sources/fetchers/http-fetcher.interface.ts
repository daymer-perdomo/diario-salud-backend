import { FetchMethod } from '@prisma/client';

export interface HttpFetcher {
  readonly method: FetchMethod;
  fetchText(url: string, opts?: { timeoutMs?: number }): Promise<string>;
}

export const HTTP_FETCHERS = 'HTTP_FETCHERS';
