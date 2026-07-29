import { IsUUID } from 'class-validator';

export class GetCartDto {
  @IsUUID()
  conversationId!: string;
}
