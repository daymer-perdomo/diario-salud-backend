import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { LlmModule } from '../llm/llm.module';
import { ScoringProcessor } from './scoring.processor';

@Module({
  imports: [QueueModule, ArticlesModule, LlmModule],
  providers: [ScoringProcessor],
})
export class ScoringModule {}
