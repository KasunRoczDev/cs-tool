import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EventBus } from '../../common/events/event-bus.port';
import { DomainEvent } from '../../common/events/domain-event';

/** Routes events to configured channels (blueprint J.9). Queues deliveries (BullMQ in prod). */
@Injectable()
export class NotificationConsumer implements OnModuleInit {
  private readonly log = new Logger(NotificationConsumer.name);
  constructor(private readonly prisma: PrismaService, private readonly bus: EventBus) {}
  onModuleInit() {
    const route = async (e: DomainEvent) => {
      const channels = await this.prisma.notificationChannel.findMany({
        where: { isActive: true, events: { has: e.type } },
      });
      for (const ch of channels) this.log.log(`notify ${ch.type} <- ${e.type}`); // enqueue delivery
    };
    ['release.promoted','deployment.failed','deployment.succeeded','hotfix.created','pr.merged','pr.opened']
      .forEach((t) => this.bus.subscribe(t, route));
  }
}
