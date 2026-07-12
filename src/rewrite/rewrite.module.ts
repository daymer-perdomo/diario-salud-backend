import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { LlmModule } from '../llm/llm.module';
import { RewriteProcessor } from './rewrite.processor';

@Module({
  imports: [QueueModule, ArticlesModule, LlmModule],
  providers: [RewriteProcessor],
})
export class RewriteModule {}
