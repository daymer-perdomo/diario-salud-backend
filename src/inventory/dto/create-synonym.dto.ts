import { ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';

export class CreateSynonymDto {
  @IsString()
  @MinLength(1)
  term!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  relatedTerms!: string[];
}
