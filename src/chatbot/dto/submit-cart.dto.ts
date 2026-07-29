import { IsString, IsUUID, MinLength } from 'class-validator';

export class SubmitCartDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  customerName!: string;

  @IsString()
  @MinLength(1)
  customerPhone!: string;
}
