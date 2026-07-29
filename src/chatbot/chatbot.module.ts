import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { CartController } from './cart.controller';
import { ChatCartService } from './chat-cart.service';
import { ChatRateLimiterService } from './chat-rate-limiter.service';

@Module({
  imports: [LlmModule, InventoryModule],
  controllers: [ChatbotController, CartController],
  providers: [ChatbotService, ChatCartService, ChatRateLimiterService],
})
export class ChatbotModule {}
