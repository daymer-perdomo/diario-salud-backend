import { IsString, MinLength } from 'class-validator';

export class CreateBlacklistEntryDto {
  @IsString()
  @MinLength(1)
  sku!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
