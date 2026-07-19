import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PromptsService } from './prompts.service';
import { PromptsController } from './prompts.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
