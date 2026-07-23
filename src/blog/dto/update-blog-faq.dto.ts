import { IsOptional, IsString } from 'class-validator';

/// `question` no es editable aqui a proposito -- viene de AlsoAsked
/// (fuente real, no se inventa). Solo se redacta `answer`.
export class UpdateBlogFaqDto {
  @IsOptional()
  @IsString()
  answer?: string;
}
