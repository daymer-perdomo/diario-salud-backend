import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Min } from 'class-validator';
import { FetchMethod, SourceType } from '@prisma/client';

export class CreateSourceDto {
  @IsString()
  institutionCode: string;

  @IsString()
  name: string;

  @IsEnum(SourceType)
  type: SourceType;

  @IsUrl()
  baseUrl: string;

  @IsString()
  country: string;

  @IsOptional()
  @IsEnum(FetchMethod)
  fetchMethod?: FetchMethod;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /// Hora del dia en formato "HH:mm" (24h) para ingesta automatica diaria.
  /// Omitir o enviar null = la fuente es manual-only (solo se ingiere
  /// via el boton "Consultar ahora"). Ver Source.scheduledTime en el schema.
  @IsOptional()
  @Matches(/^([0-1]?\d|2[0-3]):([0-5]\d)$/, { message: 'scheduledTime debe tener formato HH:mm (24h)' })
  scheduledTime?: string | null;

  /// Tope de items nuevos por corrida, uniforme para los tres tipos de
  /// adapter -- ver comentario en Source.maxItemsPerRun del schema.
  /// Omitir o enviar null = usa el default propio del adapter.
  @IsOptional()
  @IsInt()
  @Min(1)
  maxItemsPerRun?: number | null;

  /// Ventana de recencia en dias (RSS y HTML_SCRAPE) -- ver comentario en
  /// Source.maxAgeDays del schema. Omitir o enviar null = usa el default
  /// propio del adapter.
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAgeDays?: number | null;

  /// Estructura validada por cada SourceAdapter en tiempo de ejecucion
  /// (no hay un DTO unico posible porque cada `type` espera una forma
  /// distinta -- RSS quiere feedUrls, HTML_SCRAPE quiere selectores, etc).
  config: Record<string, unknown>;
}
