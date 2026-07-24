import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.port';
import { RedisEventBus } from './redis-event-bus';
import { OutboxService } from './outbox.service';
import { PrismaService } from '../prisma.service';

/** Global so any module can inject EventBus / OutboxService. */
@Global()
@Module({
  providers: [PrismaService, OutboxService, { provide: EventBus, useClass: RedisEventBus }],
  exports: [EventBus, OutboxService, PrismaService],
})
export class EventsModule {}
