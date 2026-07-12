import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ValidationDecision } from '@prisma/client';

export class ValidateArticleDto {
  @IsEnum(ValidationDecision)
  decision: ValidationDecision;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  editedTitle?: string;

  @IsOptional()
  @IsString()
  editedSummary?: string;

  @IsOptional()
  @IsString()
  editedContent?: string;
}
