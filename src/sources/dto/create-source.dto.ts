import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, Matches } from 'class-validator';
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

  /// Estructura validada por cada SourceAdapter en tiempo de ejecucion
  /// (no hay un DTO unico posible porque cada `type` espera una forma
  /// distinta -- RSS quiere feedUrls, HTML_SCRAPE quiere selectores, etc).
  config: Record<string, unknown>;
}
