import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SourcesModule } from '../sources/sources.module';
import { ArticlesModule } from '../articles/articles.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IngestionDispatcher } from './ingestion.dispatcher';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionController } from './ingestion.controller';

@Module({
  imports: [QueueModule, SourcesModule, ArticlesModule, AuditModule, AuthModule],
  controllers: [IngestionController],
  providers: [IngestionDispatcher, IngestionProcessor],
})
export class IngestionModule {}
