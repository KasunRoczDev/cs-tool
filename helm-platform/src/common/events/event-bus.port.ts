import { DomainEvent } from './domain-event';

/** Port: swap Redis Streams -> NATS/Kafka without touching domain code (blueprint J.11). */
export abstract class EventBus {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe(type: string, handler: (e: DomainEvent) => Promise<void>): void;
}
