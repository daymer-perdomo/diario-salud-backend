import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { FilteringProcessor } from './filtering.processor';

@Module({
  imports: [QueueModule, ArticlesModule],
  providers: [FilteringProcessor],
})
export class FilteringModule {}
