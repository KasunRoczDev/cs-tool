import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DomainEvent } from './domain-event';
import { EventBus } from './event-bus.port';
import { randomUUID } from 'crypto';

/**
 * Transactional outbox (blueprint C.4.3). write(tx, ...) enlists the event in the SAME
 * DB transaction as the state change; OutboxRelay publishes asynchronously.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService, private readonly bus: EventBus) {}

  async write(tx: any, partial: Omit<DomainEvent, 'eventId' | 'version' | 'occurredAt'>): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      version: 1,
      occurredAt: new Date().toISOString(),
      ...partial,
    };
    await tx.eventOutbox.create({
      data: {
        aggregateType: event.subject.type,
        aggregateId: event.subject.id,
        type: event.type,
        payload: event as any,
      },
    });
  }

  /** Relay loop (helm-worker): tail unpublished rows -> bus -> mark published. */
  async relayOnce(batch = 100): Promise<number> {
    const rows = await this.prisma.eventOutbox.findMany({
      where: { published: false }, orderBy: { id: 'asc' }, take: batch,
    });
    for (const row of rows) {
      await this.bus.publish(row.payload as unknown as DomainEvent);
      await this.prisma.eventOutbox.update({ where: { id: row.id }, data: { published: true } });
    }
    return rows.length;
  }
}
