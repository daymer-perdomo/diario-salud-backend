import { IsInt, IsString, IsUUID, MinLength } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  sku!: string;

  /// <= 0 quita el producto del carrito (ver ChatCartService.addItem).
  @IsInt()
  quantity!: number;
}
