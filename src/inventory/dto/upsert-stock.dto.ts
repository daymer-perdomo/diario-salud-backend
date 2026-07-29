import { IsInt, IsNumber, Min } from 'class-validator';

export class UpsertStockDto {
  @IsInt()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  price!: number;
}
