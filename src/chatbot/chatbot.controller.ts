import { Body, Controller, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChatbotService } from './chatbot.service';
import { ChatRateLimiterService, ChatRateLimitedError } from './chat-rate-limiter.service';
import { SendMessageDto } from './dto/send-message.dto';
import { hashIp } from './hash-ip.util';
import { LlmBudgetExceededError } from '../llm/llm-budget.service';

/// UNICO endpoint sin JwtAuthGuard/RolesGuard/ApiKeyGuard de todo el
/// backend (ver plan kind-giggling-cerf.md) -- consumido directo desde el
/// widget de WordPress, sin cuenta de usuario. La proteccion contra abuso
/// es el ThrottlerGuard global (app.module.ts) + @Throttle mas estricto
/// aca + ChatRateLimiterService por sesion/IP -- nunca autenticacion.
@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly rateLimiter: ChatRateLimiterService,
  ) {}

  @Post('message')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sendMessage(@Body() dto: SendMessageDto, @Req() req: Request) {
    const ipHash = hashIp(req.ip ?? 'unknown');

    // El sessionId real (conversationId) puede no existir todavia en el
    // primer mensaje -- se usa el propio hash de IP como llave temporal
    // del limite "por sesion" en ese caso, ChatbotService crea la sesion
    // real justo despues.
    try {
      await this.rateLimiter.assertWithinLimit(dto.conversationId ?? ipHash, ipHash);
    } catch (err) {
      if (err instanceof ChatRateLimitedError) {
        throw new HttpException('Demasiados mensajes, intenta de nuevo en un momento.', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }

    try {
      return await this.chatbotService.handleMessage({
        conversationId: dto.conversationId,
        message: dto.message,
        ipHash,
      });
    } catch (err) {
      if (err instanceof LlmBudgetExceededError) {
        this.logger.error(err.message);
        throw new HttpException('El chatbot no esta disponible en este momento, intenta mas tarde.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw err;
    }
  }
}
