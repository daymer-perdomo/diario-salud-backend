import { Injectable, Logger } from '@nestjs/common';
import { Source, SourceType, FetchMethod } from '@prisma/client';
import { SourceAdapter } from '../interfaces/source-adapter.interface';
import { FetchResult, RawCandidate } from '../interfaces/raw-candidate.interface';
import { computeContentHash } from '../../common/content-hash.util';
import { HttpFetcherFactory } from '../fetchers/http-fetcher.factory';

/// Config esperada en Source.config para type=OPEN_DATA_API (Socrata /
/// datos.gov.co). Confirmado en vivo contra
/// https://www.datos.gov.co/resource/fhc4-jjti.json (SIVIGILA - INS):
/// campos reales = cod_eve, nombre_evento, semana, ano,
/// municipio_ocurrencia, departamento_ocurrencia, conteo.
/// No existe un campo de fecha unico en este dataset (es semana
/// epidemiologica + ano), por eso no se usa cursor por fecha: se re-pide
/// una ventana reciente en cada corrida y se deja que el @@unique de
/// Prisma sobre (sourceId, originalContentHash) deduplique, igual que en
/// RssAdapter. Si el cliente confirma que se deben ingerir anios/recursos
/// adicionales (ver pregunta abierta #11 del plan), agregar cada resource
/// id de Socrata como una entrada nueva en apiUrls.
interface OpenDataApiSourceConfig {
  apiUrls: string[];
  order: string; // p.ej. "ano DESC, semana DESC"
  limit?: number;
  maxAgeDays?: number;
  datasetLandingUrl: string; // pagina publica del dataset, para trazabilidad legible
}

/// Agregado 2026-07-17 (pedido explicito del usuario): este adapter NO
/// filtraba por fecha -- a diferencia de RssAdapter/HtmlScraperAdapter,
/// que siempre tuvieron una ventana de recencia, aqui se pedian las N
/// filas mas recientes del dataset sin verificar que fueran realmente
/// recientes. Con SIVIGILA en particular esto importa mucho: el dataset
/// nacional agregado mas reciente en datos.gov.co es de 2021 (ver notas
/// de la fuente INS en sources.seed-data.ts) -- sin este filtro se
/// gastaba IA evaluando "noticias" de hace años. Mismo default que los
/// otros adapters (subido de 3 a 7 el 2026-08-04, ver comentario
/// equivalente en RssAdapter -- no cambia nada para INS: su dataset es de
/// 2021, sigue en 0 items con cualquier ventana de dias razonable).
const DEFAULT_MAX_AGE_DAYS = 7;
/// Tope final tras el filtro de fecha -- mismo default que RssAdapter/
/// HtmlScraperAdapter (ver sus comentarios equivalentes).
const DEFAULT_MAX_ITEMS_PER_RUN = 3;

interface SivigilaRow {
  cod_eve: string;
  nombre_evento: string;
  semana: string;
  ano: string;
  municipio_ocurrencia: string;
  departamento_ocurrencia: string;
  conteo: string;
}

@Injectable()
export class OpenDataApiAdapter implements SourceAdapter {
  readonly type = SourceType.OPEN_DATA_API;
  private readonly logger = new Logger(OpenDataApiAdapter.name);

  constructor(private readonly fetcherFactory: HttpFetcherFactory) {}

  async fetchCandidates(source: Source, _cursor: unknown | null): Promise<FetchResult> {
    const config = source.config as unknown as OpenDataApiSourceConfig;
    if (!config?.apiUrls?.length) {
      throw new Error(`Source ${source.institutionCode}: config.apiUrls vacio o ausente`);
    }

    const fetcher = this.fetcherFactory.get(source.fetchMethod ?? FetchMethod.HTTP_SIMPLE);
    const items: RawCandidate[] = [];
    const errors: string[] = [];
    // Tamano de la consulta a Socrata -- deliberadamente independiente de
    // Source.maxItemsPerRun (2026-07-17): ese campo ahora es el tope FINAL
    // de items a conservar tras el filtro de fecha (ver mas abajo), no el
    // tamano del pool candidato. Pedir un pool generoso aqui deja margen
    // para que el filtro de recencia tenga de donde elegir.
    const limit = config.limit ?? 200;

    for (const apiUrl of config.apiUrls) {
      try {
        const url = `${apiUrl}?$order=${encodeURIComponent(config.order)}&$limit=${limit}`;
        const body = await fetcher.fetchText(url);
        const rows = JSON.parse(body) as SivigilaRow[];

        for (const row of rows) {
          if (!row.nombre_evento || !row.ano || !row.semana) continue;

          // Texto factual derivado 1:1 de los campos oficiales del dataset --
          // no se agrega ninguna interpretacion aqui, solo transcripcion.
          const rawText =
            `El municipio de ${row.municipio_ocurrencia} (${row.departamento_ocurrencia}) ` +
            `reporto ${row.conteo} caso(s) de "${row.nombre_evento}" en la semana ` +
            `epidemiologica ${row.semana} del anio ${row.ano}, segun datos SIVIGILA del INS ` +
            `(codigo de evento ${row.cod_eve}).`;
          const title = `SIVIGILA: ${row.nombre_evento} - semana ${row.semana}/${row.ano} - ${row.municipio_ocurrencia}`;

          // URL verificable: consulta Socrata acotada exactamente a esta fila
          // (no una URL inventada) -- cualquiera puede abrirla y ver el dato crudo.
          const rowUrl =
            `${apiUrl}?cod_eve=${encodeURIComponent(row.cod_eve)}` +
            `&ano=${encodeURIComponent(row.ano)}&semana=${encodeURIComponent(row.semana)}` +
            `&municipio_ocurrencia=${encodeURIComponent(row.municipio_ocurrencia)}`;

          items.push({
            externalId: `${row.cod_eve}-${row.ano}-${row.semana}-${row.municipio_ocurrencia}`,
            url: rowUrl,
            title,
            excerpt: null,
            publishedAt: epidemiologicalWeekToDate(row.ano, row.semana),
            rawText,
            contentHash: computeContentHash(title, rawText),
            imageUrl: null, // SIVIGILA es un dataset tabular, no expone imagenes
          });
        }
      } catch (err) {
        const message = `${apiUrl}: ${(err as Error).message}`;
        this.logger.error(`Fallo al leer dataset abierto (fuente ${source.institutionCode}): ${message}`);
        errors.push(message);
      }
    }

    if (errors.length === config.apiUrls.length) {
      throw new Error(`Todos los endpoints de ${source.institutionCode} fallaron: ${errors.join(' | ')}`);
    }

    // Ventana de recencia, mismo criterio que RssAdapter/HtmlScraperAdapter
    // -- Source.maxAgeDays (configurable desde el panel) tiene prioridad
    // sobre config.maxAgeDays.
    const maxAgeDays = source.maxAgeDays ?? config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const withinWindow = items
      .filter((item) => item.publishedAt >= cutoffDate)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    // Tope final tras el filtro de fecha, mismo criterio que
    // RssAdapter/HtmlScraperAdapter (2026-07-17): solo se conservan las
    // maxItemsPerRun filas mas recientes -- aqui es donde Source.maxItemsPerRun
    // realmente aplica (ver comentario arriba sobre el tamano de la consulta).
    const maxItemsToKeep = source.maxItemsPerRun ?? DEFAULT_MAX_ITEMS_PER_RUN;
    const bounded = withinWindow.slice(0, maxItemsToKeep);

    if (items.length > bounded.length) {
      this.logger.warn(
        `Fuente ${source.institutionCode}: ${items.length} filas obtenidas, ${withinWindow.length} dentro de ` +
          `la ventana de ${maxAgeDays} dias, acotado a ${bounded.length} (maxItemsPerRun=${maxItemsToKeep}) -- ` +
          `el resto se descarta, no se procesa con IA.`,
      );
    }

    return { items: bounded, nextCursor: null };
  }
}

/// Aproxima el lunes de la semana epidemiologica ISO dada -- se usa solo
/// para ordenar/mostrar fecha, el dato oficial real es (ano, semana), que
/// se conserva integro en el texto.
function epidemiologicalWeekToDate(ano: string, semana: string): Date {
  const year = parseInt(ano, 10);
  const week = parseInt(semana, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}
