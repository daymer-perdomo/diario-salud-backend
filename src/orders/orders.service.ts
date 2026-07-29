import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryOrdersDto } from './dto/query-orders.dto';

const ORDER_INCLUDE = { items: true, session: { select: { channel: true } } } as const;

/// Solicitudes de pedido armadas desde el chatbot (ver ChatCartService) --
/// BORRADOR nunca aparece aca (todavia no es una solicitud real, el
/// cliente sigue editando su carrito), solo PENDIENTE/CONFIRMADO/
/// CANCELADO son visibles/gestionables desde el panel.
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      status: query.status ?? { not: OrderRequestStatus.BORRADOR },
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.orderRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ORDER_INCLUDE,
      }),
      this.prisma.orderRequest.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(id: string) {
    const order = await this.prisma.orderRequest.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    return order;
  }

  async updateStatus(id: string, status: OrderRequestStatus) {
    await this.findOne(id);
    return this.prisma.orderRequest.update({ where: { id }, data: { status }, include: ORDER_INCLUDE });
  }
}
