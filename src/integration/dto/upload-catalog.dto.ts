import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CatalogItemDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  sku!: string;

  @IsString()
  name!: string;

  @IsString()
  permalink!: string;

  /// Puede venir null: en WooCommerce hay productos sin imagen.
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsString()
  stockStatus!: string;

  @IsString()
  catalogVisibility!: string;

  @IsBoolean()
  manageStock!: boolean;
}

/// Una tanda del catalogo de WooCommerce. El plugin lo sube por paginas
/// porque son ~42,300 productos: mandarlos en una sola peticion excederia
/// cualquier limite razonable de tamano de body y de tiempo de ejecucion de
/// PHP. ArrayMaxSize(500) es el tope por peticion.
export class UploadCatalogDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CatalogItemDto)
  items!: CatalogItemDto[];
}
