import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { LlmModule } from '../llm/llm.module';
import { ComplianceProcessor } from './compliance.processor';

@Module({
  imports: [QueueModule, ArticlesModule, LlmModule],
  providers: [ComplianceProcessor],
})
export class ComplianceModule {}
