import { Injectable, Logger } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { EventBus } from './event-bus.port';
import { DomainEvent } from './domain-event';

const STREAM = 'helm.events';

/** Redis Streams implementation of the EventBus port (MVP). */
@Injectable()
export class RedisEventBus extends EventBus {
  private readonly log = new Logger(RedisEventBus.name);
  private readonly redis: Redis;
  private readonly handlers = new Map<string, ((e: DomainEvent) => Promise<void>)[]>();

  constructor() {
    super();
    this.redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.redis.xadd(STREAM, '*', 'type', event.type, 'payload', JSON.stringify(event));
  }

  subscribe(type: string, handler: (e: DomainEvent) => Promise<void>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  /** Called by helm-worker: consumer-group loop (simplified). */
  async startConsumer(group = 'helm-workers', consumer = 'w1'): Promise<void> {
    try { await this.redis.xgroup('CREATE', STREAM, group, '$', 'MKSTREAM'); } catch { /* exists */ }
    for (;;) {
      const res = await this.redis.xreadgroup('GROUP', group, consumer, 'BLOCK', 5000, 'COUNT', 50, 'STREAMS', STREAM, '>');
      if (!res) continue;
      for (const [, entries] of res as any) {
        for (const [id, fields] of entries) {
          const payload = JSON.parse(fields[fields.indexOf('payload') + 1]) as DomainEvent;
          for (const h of this.handlers.get(payload.type) ?? []) {
            try { await h(payload); } catch (err) { this.log.error(`handler failed for ${payload.type}`, err as Error); }
          }
          await this.redis.xack(STREAM, group, id);
        }
      }
    }
  }
}
