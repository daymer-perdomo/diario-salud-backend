import { Body, Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChatCartService } from './chat-cart.service';
import { ChatRateLimiterService, ChatRateLimitedError } from './chat-rate-limiter.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { GetCartDto } from './dto/get-cart.dto';
import { SubmitCartDto } from './dto/submit-cart.dto';
import { hashIp } from './hash-ip.util';

/// Mismo espiritu que ChatbotController: publico, sin login, protegido
/// solo por rate limiting (nunca autenticacion) -- el carrito es parte
/// de la misma conversacion de chat, solo que las cantidades/precios se
/// manejan de forma determinista en vez de pasar por el LLM.
@Controller('chatbot/cart')
export class CartController {
  constructor(
    private readonly cartService: ChatCartService,
    private readonly rateLimiter: ChatRateLimiterService,
  ) {}

  private async checkRateLimit(conversationId: string, req: Request): Promise<void> {
    const ipHash = hashIp(req.ip ?? 'unknown');
    try {
      await this.rateLimiter.assertWithinLimit(conversationId, ipHash);
    } catch (err) {
      if (err instanceof ChatRateLimitedError) {
        throw new HttpException('Demasiadas acciones, intenta de nuevo en un momento.', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }
  }

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getCart(@Query() dto: GetCartDto) {
    return this.cartService.getCart(dto.conversationId);
  }

  @Post('items')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async addItem(@Body() dto: AddCartItemDto, @Req() req: Request) {
    await this.checkRateLimit(dto.conversationId, req);
    return this.cartService.addItem(dto.conversationId, dto.sku, dto.quantity);
  }

  @Post('submit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submit(@Body() dto: SubmitCartDto, @Req() req: Request) {
    await this.checkRateLimit(dto.conversationId, req);
    return this.cartService.submit(dto.conversationId, dto.customerName, dto.customerPhone);
  }

  /// Consulta de estado por referencia (menu "Ver el estado de mi
  /// solicitud" del widget) -- no exige conversationId, alguien puede
  /// revisar su pedido desde otra sesion/dispositivo con solo el codigo.
  @Get('status/:reference')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async getStatus(@Param('reference') reference: string) {
    const order = await this.cartService.findByReference(reference);
    if (!order) throw new NotFoundException('No encontramos una solicitud con ese número de referencia.');
    return order;
  }
}
