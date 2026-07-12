import { Inject, Injectable } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { SourceAdapter, SOURCE_ADAPTERS } from '../interfaces/source-adapter.interface';

@Injectable()
export class AdapterFactory {
  constructor(@Inject(SOURCE_ADAPTERS) private readonly adapters: SourceAdapter[]) {}

  get(type: SourceType): SourceAdapter {
    const adapter = this.adapters.find((a) => a.type === type);
    if (!adapter) {
      throw new Error(`No hay SourceAdapter registrado para el tipo ${type}`);
    }
    return adapter;
  }
}
