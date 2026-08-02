import { IsBoolean, IsOptional, IsString } from 'class-validator';

/// Campos editables a mano desde el panel entre importaciones de Excel --
/// sku y la trazabilidad (sourceFile/sourceRow) no se tocan aqui, solo
/// vienen del import masivo.
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  activeIngredient?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  requiresPrescription?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  hiddenFromCatalog?: boolean;
}
