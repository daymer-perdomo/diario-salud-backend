import { IsOptional, IsString } from 'class-validator';

export class CreateBlogFaqDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString()
  answer?: string;
}
