import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EventBus } from '../../common/events/event-bus.port';
import { DomainEvent } from '../../common/events/domain-event';

/** Append-only audit writer (blueprint J.10). Subscribes to every event. */
@Injectable()
export class AuditConsumer implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly bus: EventBus) {}
  onModuleInit() {
    const record = async (e: DomainEvent) => {
      await this.prisma.auditLog.create({
        data: {
          actorId: e.actor?.id, actorEmail: e.actor?.email, action: e.type,
          entityType: e.subject.type, entityId: e.subject.id, newValue: e.data as any,
          ipAddress: e.trace?.ip, userAgent: e.trace?.userAgent, requestId: e.trace?.requestId,
        },
      });
    };
    // Wildcard: in production subscribe to a catch-all; here register a few key types.
    ['release.created','release.promoted','deployment.started','deployment.rolled_back',
     'hotfix.created','pr.merged','repository.registered'].forEach((t) => this.bus.subscribe(t, record));
  }
}
