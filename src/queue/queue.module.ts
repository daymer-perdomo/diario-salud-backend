import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';
import { buildRedisConnectionOptions } from '../config/redis-connection.util';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnectionOptions(config),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.INGEST },
      { name: QUEUE_NAMES.FILTER },
      { name: QUEUE_NAMES.SCORE },
      { name: QUEUE_NAMES.REWRITE },
      { name: QUEUE_NAMES.GROUND },
      { name: QUEUE_NAMES.COMPLIANCE },
      { name: QUEUE_NAMES.PUBLISH },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
