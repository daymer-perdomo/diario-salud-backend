import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WordpressPublishService } from './wordpress-publish.service';
import { WordpressController } from './wordpress.controller';

@Module({
  imports: [AuthModule],
  controllers: [WordpressController],
  providers: [WordpressPublishService],
  exports: [WordpressPublishService],
})
export class WordpressModule {}
