import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SourcesModule } from '../sources/sources.module';
import { ArticlesModule } from '../articles/articles.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RewriteModule } from '../rewrite/rewrite.module';
import { IngestionDispatcher } from './ingestion.dispatcher';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionController } from './ingestion.controller';
import { IngestionRunsService } from './ingestion-runs.service';
import { IngestionRunTrackerService } from './ingestion-run-tracker.service';

@Module({
  imports: [QueueModule, SourcesModule, ArticlesModule, AuditModule, AuthModule, RewriteModule],
  controllers: [IngestionController],
  providers: [IngestionDispatcher, IngestionProcessor, IngestionRunsService, IngestionRunTrackerService],
})
export class IngestionModule {}
