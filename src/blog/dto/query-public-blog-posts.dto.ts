import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/// Sin filtro de estado (draftStatus/reviewStatus/medicalValidationStatus)
/// a proposito: a diferencia de Articles, el modulo de Blog todavia no
/// tiene un pipeline de validacion que distinga "aprobado" de "borrador" --
/// por ahora la API publica expone todo lo que exista en BlogPost (decision
/// explicita del 2026-08-07, ver docs/integracion-wordpress-diario-salud.md).
export class QueryPublicBlogPostsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  hub?: string;
}
