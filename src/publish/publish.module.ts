import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { AuthModule } from '../auth/auth.module';
import { WordpressModule } from '../wordpress/wordpress.module';
import { PublishService } from './publish.service';
import { PublishController } from './publish.controller';

@Module({
  imports: [ArticlesModule, AuthModule, WordpressModule],
  controllers: [PublishController],
  providers: [PublishService],
})
export class PublishModule {}
