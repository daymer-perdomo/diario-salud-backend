import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArticlesModule } from '../articles/articles.module';
import { AuthModule } from '../auth/auth.module';
import { ValidationService } from './validation.service';
import { ValidationController } from './validation.controller';

@Module({
  imports: [QueueModule, ArticlesModule, AuthModule],
  controllers: [ValidationController],
  providers: [ValidationService],
})
export class ValidationModule {}
