import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { BlogDraftStatus } from '@prisma/client';

export class QueryBlogPostsDto {
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
  @IsEnum(BlogDraftStatus)
  draftStatus?: BlogDraftStatus;

  @IsOptional()
  @IsString()
  contentType?: string;
}
