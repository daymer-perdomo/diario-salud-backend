import { IsOptional, IsString } from 'class-validator';

/// `heading` no es editable aqui a proposito -- es el H2 obligatorio que
/// viene del Excel. Solo se redacta `body`.
export class UpdateBlogSectionDto {
  @IsOptional()
  @IsString()
  body?: string;
}
