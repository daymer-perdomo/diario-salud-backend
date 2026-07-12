import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { AuthModule } from '../auth/auth.module';
import { WordpressClientService } from './wordpress-client.service';
import { PublishService } from './publish.service';
import { PublishController } from './publish.controller';

@Module({
  imports: [ArticlesModule, AuthModule],
  controllers: [PublishController],
  providers: [WordpressClientService, PublishService],
})
export class PublishModule {}
