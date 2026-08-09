import { IsIn, IsOptional, IsString } from 'class-validator';
import { BlogReviewDecision } from '@prisma/client';

export class CreateBlogReviewDto {
  /// PENDIENTE no es una decision valida de enviar -- es el estado inicial
  /// (default del schema / backfill), nunca algo que alguien "aprueba".
  @IsIn([BlogReviewDecision.APROBADO, BlogReviewDecision.RECHAZADO])
  decision: BlogReviewDecision;

  @IsOptional()
  @IsString()
  notes?: string;
}
