import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { LlmModule } from '../llm/llm.module';
import { AuthModule } from '../auth/auth.module';
import { RewriteProcessor } from './rewrite.processor';
import { RewriteSelectionService } from './rewrite-selection.service';
import { RewriteController } from './rewrite.controller';

@Module({
  imports: [QueueModule, ArticlesModule, LlmModule, AuthModule],
  controllers: [RewriteController],
  providers: [RewriteProcessor, RewriteSelectionService],
  exports: [RewriteSelectionService],
})
export class RewriteModule {}
