import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { DistrimonacoSyncService } from './distrimonaco-sync.service';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService, DistrimonacoSyncService],
  exports: [InventoryService],
})
export class InventoryModule {}
