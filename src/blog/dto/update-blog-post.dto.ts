import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BlogDraftStatus } from '@prisma/client';

/// Solo los campos que el redactor puede tocar desde el panel -- todo lo
/// demas (hub, H2 obligatorios, reglas, politica de productos, etc.) viene
/// del Excel y es de solo lectura en esta fase.
export class UpdateBlogPostDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsEnum(BlogDraftStatus)
  draftStatus?: BlogDraftStatus;
}
