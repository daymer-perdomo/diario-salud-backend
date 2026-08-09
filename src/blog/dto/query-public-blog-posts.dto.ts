import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/// Sin filtro de estado de redaccion (draftStatus/reviewStatus/
/// medicalValidationStatus) a proposito -- eso sigue sin pantalla propia.
/// El gate real de "aprobado" (reviewDecision, ver BlogService.publishPost)
/// ya existe desde 2026-08-09 pero solo bloquea *publicar*, no filtra la
/// API publica -- todo lo que tenga `published: true` se expone igual.
///
/// `contentType` sí filtra: sin especificarlo, se mantiene el
/// comportamiento de siempre (contenido tipo Blog / posts legados con
/// contentType null, decision explicita del 2026-08-07, ver
/// docs/integracion-wordpress-diario-salud.md) -- Hub y Enciclopedia solo
/// se exponen si se piden explicitamente, ver BlogService.findPublicPosts.
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

  @IsOptional()
  @IsString()
  contentType?: string;
}
