import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatMessageRole, OrderRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

const ORDER_REQUEST_INCLUDE = {
  items: { include: { product: { select: { requiresPrescription: true, isActive: true } } } },
} as const;

export interface CartItemView {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  requiresPrescription: boolean;
}

export interface CartSummary {
  orderRequestId: string | null;
  status: OrderRequestStatus | null;
  items: CartItemView[];
  total: number;
  notices: string[];
}

/// Carrito/solicitud de pedido del chatbot -- 100% determinista, el LLM
/// nunca participa (ver plan del usuario: "no dejar que la IA sea la
/// fuente de verdad de numeros"). NUNCA es un checkout real ni pago en
/// linea -- termina en una OrderRequest con status PENDIENTE que el
/// personal confirma/cancela desde el panel (ver OrdersController).
@Injectable()
export class ChatCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private async getSessionOrThrow(conversationId: string) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: conversationId } });
    if (!session) throw new NotFoundException('Conversación no encontrada -- envía primero un mensaje al chatbot.');
    return session;
  }

  /// Un BORRADOR a la vez por sesion -- si ya se envio una solicitud
  /// (PENDIENTE) y el cliente sigue agregando productos, se abre un
  /// BORRADOR nuevo para la siguiente.
  private async findOrCreateDraftCart(sessionId: string) {
    const existing = await this.prisma.orderRequest.findFirst({
      where: { sessionId, status: OrderRequestStatus.BORRADOR },
      include: ORDER_REQUEST_INCLUDE,
    });
    if (existing) return existing;

    return this.prisma.orderRequest.create({
      data: { sessionId, status: OrderRequestStatus.BORRADOR },
      include: ORDER_REQUEST_INCLUDE,
    });
  }

  private toSummary(cart: { id: string; status: OrderRequestStatus; items: Array<{ skuSnapshot: string; nameSnapshot: string; priceSnapshot: unknown; quantity: number; product: { requiresPrescription: boolean; isActive: boolean } }> } | null): CartSummary {
    if (!cart) return { orderRequestId: null, status: null, items: [], total: 0, notices: [] };

    const items: CartItemView[] = cart.items.map((i) => ({
      sku: i.skuSnapshot,
      name: i.nameSnapshot,
      price: Number(i.priceSnapshot),
      quantity: i.quantity,
      subtotal: Number(i.priceSnapshot) * i.quantity,
      requiresPrescription: i.product.requiresPrescription,
    }));
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);
    const notices = items
      .filter((i) => i.requiresPrescription)
      .map((i) => `${i.name} requiere receta médica -- la entrega queda sujeta a validarla en sucursal.`);

    return { orderRequestId: cart.id, status: cart.status, items, total, notices };
  }

  async getCart(conversationId: string): Promise<CartSummary> {
    await this.getSessionOrThrow(conversationId);
    const cart = await this.prisma.orderRequest.findFirst({
      where: { sessionId: conversationId, status: OrderRequestStatus.BORRADOR },
      include: ORDER_REQUEST_INCLUDE,
    });
    return this.toSummary(cart);
  }

  /// quantity <= 0 quita el producto del carrito. quantity > stock
  /// disponible se recorta al stock real -- nunca se deja "pedir" mas de
  /// lo que hay, el mismo principio de nunca inventar/exceder un hecho
  /// real de inventario.
  async addItem(conversationId: string, sku: string, quantity: number): Promise<CartSummary> {
    await this.getSessionOrThrow(conversationId);
    const cart = await this.findOrCreateDraftCart(conversationId);
    if (cart.status !== OrderRequestStatus.BORRADOR) {
      throw new BadRequestException('Esta solicitud ya fue enviada y no se puede modificar.');
    }

    const product = await this.inventory.findBySku(sku);
    if (!product || !product.isActive) {
      throw new NotFoundException(`Producto ${sku} no encontrado`);
    }

    if (quantity <= 0) {
      await this.prisma.orderRequestItem.deleteMany({ where: { orderRequestId: cart.id, productId: product.id } });
      return this.getCart(conversationId);
    }

    const totalStock = product.stock.reduce((sum, s) => sum + s.quantity, 0);
    if (totalStock <= 0) {
      throw new BadRequestException(`${product.name} no tiene stock disponible en este momento.`);
    }
    const clampedQuantity = Math.min(quantity, totalStock);
    const price = product.stock[0]?.price ?? 0;

    await this.prisma.orderRequestItem.upsert({
      where: { orderRequestId_productId: { orderRequestId: cart.id, productId: product.id } },
      update: { quantity: clampedQuantity, nameSnapshot: product.name, priceSnapshot: price },
      create: {
        orderRequestId: cart.id,
        productId: product.id,
        skuSnapshot: product.sku,
        nameSnapshot: product.name,
        priceSnapshot: price,
        quantity: clampedQuantity,
      },
    });

    return this.getCart(conversationId);
  }

  async submit(conversationId: string, customerName: string, customerPhone: string): Promise<CartSummary & { reference: string }> {
    await this.getSessionOrThrow(conversationId);
    const name = customerName.trim();
    const phone = customerPhone.trim();
    if (!name || !phone) {
      throw new BadRequestException('Se necesita un nombre y un teléfono de contacto para enviar la solicitud.');
    }

    const cart = await this.prisma.orderRequest.findFirst({
      where: { sessionId: conversationId, status: OrderRequestStatus.BORRADOR },
      include: ORDER_REQUEST_INCLUDE,
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('No hay productos en el carrito todavía.');
    }

    await this.prisma.orderRequest.update({
      where: { id: cart.id },
      data: { status: OrderRequestStatus.PENDIENTE, customerName: name, customerPhone: phone },
    });

    const reference = cart.id.slice(0, 8).toUpperCase();
    const summary = this.toSummary({ ...cart, status: OrderRequestStatus.PENDIENTE });

    await this.prisma.chatMessage.create({
      data: {
        sessionId: conversationId,
        role: ChatMessageRole.ASSISTANT,
        content: `Solicitud #${reference} registrada para ${name} (${phone}): ${summary.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}. Nuestro personal te contactará para confirmar.`,
      },
    });
    await this.prisma.chatSession.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });

    return { ...summary, reference };
  }

  /// Consulta publica de estado por numero de referencia (menu "Ver el
  /// estado de mi solicitud" del widget) -- a proposito NO devuelve
  /// customerName/customerPhone: cualquiera con el codigo puede ver el
  /// estado (como rastrear un pedido), pero no datos de contacto de otra
  /// persona. `reference` es el prefijo de 8 caracteres que se le dio al
  /// cliente en submit() -- se busca por prefijo del id real.
  async findByReference(reference: string): Promise<{ reference: string; status: OrderRequestStatus; items: Array<{ name: string; quantity: number }>; total: number } | null> {
    const normalized = reference.trim().toLowerCase();
    if (normalized.length < 6) return null;

    const order = await this.prisma.orderRequest.findFirst({
      where: { id: { startsWith: normalized }, status: { not: OrderRequestStatus.BORRADOR } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!order) return null;

    const items = order.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity }));
    const total = order.items.reduce((sum, i) => sum + Number(i.priceSnapshot) * i.quantity, 0);
    return { reference: order.id.slice(0, 8).toUpperCase(), status: order.status, items, total };
  }
}
