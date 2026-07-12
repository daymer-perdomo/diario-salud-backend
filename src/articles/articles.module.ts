import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ArticlesService } from './articles.service';
import { ArticleStateMachineService } from './article-state-machine.service';
import { ArticlesController } from './articles.controller';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [AuditModule],
  controllers: [ArticlesController],
  providers: [ArticlesService, ArticleStateMachineService, ApiKeyGuard],
  exports: [ArticlesService, ArticleStateMachineService],
})
export class ArticlesModule {}
