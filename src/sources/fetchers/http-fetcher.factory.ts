import { Inject, Injectable } from '@nestjs/common';
import { FetchMethod } from '@prisma/client';
import { HttpFetcher, HTTP_FETCHERS } from './http-fetcher.interface';

@Injectable()
export class HttpFetcherFactory {
  constructor(@Inject(HTTP_FETCHERS) private readonly fetchers: HttpFetcher[]) {}

  get(method: FetchMethod): HttpFetcher {
    const fetcher = this.fetchers.find((f) => f.method === method);
    if (!fetcher) {
      throw new Error(`No hay HttpFetcher registrado para el metodo ${method}`);
    }
    return fetcher;
  }
}
