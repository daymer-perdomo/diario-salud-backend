import { IsString, MinLength } from 'class-validator';

export class SearchWoocommerceProductsDto {
  @IsString()
  @MinLength(2)
  q: string;
}
