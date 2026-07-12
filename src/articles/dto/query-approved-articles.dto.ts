import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/// state se restringe a mano (no @IsEnum(ArticleState)) porque esta API
/// solo debe poder filtrar dentro del universo ya aprobado por el
/// revisor -- nunca a estados internos del pipeline (BORRADOR, ERROR, etc).
export class QueryApprovedArticlesDto {
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
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsIn(['VALIDADO', 'PUBLICADO'])
  state?: 'VALIDADO' | 'PUBLICADO';
}
