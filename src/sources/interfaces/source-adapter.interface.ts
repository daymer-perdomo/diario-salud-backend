import { Source, SourceType } from '@prisma/client';
import { FetchResult } from './raw-candidate.interface';

/// Contrato uniforme para RSS, scraping HTML y APIs de datos abiertos.
/// La seleccion de selectores/URLs por fuente vive en Source.config (JSON),
/// nunca hardcodeada aqui -- eso es lo que permite agregar una fuente nueva
/// sin tocar codigo, solo una fila en el catalogo (ver SourcesModule).
export interface SourceAdapter {
  readonly type: SourceType;
  fetchCandidates(source: Source, cursor: unknown | null): Promise<FetchResult>;
}

export const SOURCE_ADAPTERS = 'SOURCE_ADAPTERS';
