import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { LlmModule } from '../llm/llm.module';
import { GroundingProcessor } from './grounding.processor';

@Module({
  imports: [QueueModule, ArticlesModule, LlmModule],
  providers: [GroundingProcessor],
})
export class GroundingModule {}
