import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { PipelineStatusService } from './pipeline-status.service';
import { PipelineStatusController } from './pipeline-status.controller';

@Module({
  imports: [QueueModule, AuthModule],
  controllers: [PipelineStatusController],
  providers: [PipelineStatusService],
})
export class PipelineStatusModule {}
