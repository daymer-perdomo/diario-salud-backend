import { IsOptional, IsString } from 'class-validator';

export class CreateBlogSectionDto {
  @IsString()
  heading: string;

  @IsOptional()
  @IsString()
  body?: string;
}
