import { IsIn } from 'class-validator';
import { OrderRequestStatus } from '@prisma/client';

/// Solo CONFIRMADO/CANCELADO son transiciones validas desde el panel --
/// BORRADOR/PENDIENTE las pone el propio flujo del chatbot (ver
/// ChatCartService), un admin nunca "reabre" una solicitud a borrador.
export class UpdateOrderStatusDto {
  @IsIn([OrderRequestStatus.CONFIRMADO, OrderRequestStatus.CANCELADO])
  status!: OrderRequestStatus;
}
