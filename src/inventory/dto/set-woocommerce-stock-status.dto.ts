import { IsBoolean } from 'class-validator';

export class SetWoocommerceStockStatusDto {
  @IsBoolean()
  outOfStock: boolean;
}
