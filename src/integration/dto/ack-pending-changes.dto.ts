import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AckResultDto {
  /// Id del WoocommercePendingChange tal como lo entrego
  /// GET /integration/woocommerce/pending-changes.
  @IsUUID()
  id!: string;

  /// true = el plugin lo aplico en WooCommerce; false = fallo y no se
  /// aplico. Un fallo NO se reintenta solo: queda FALLIDO con su mensaje
  /// para que se vea en el dashboard, en vez de repetirse en cada corrida.
  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

export class AckPendingChangesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AckResultDto)
  results!: AckResultDto[];
}
