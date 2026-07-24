import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EventBus } from './common/events/event-bus.port';
import { RedisEventBus } from './common/events/redis-event-bus';
import { OutboxService } from './common/events/outbox.service';

/**
 * helm-worker entrypoint: drains the outbox to the bus and runs the consumer loop
 * (audit, notification, etc. subscribe via their OnModuleInit).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const outbox = app.get(OutboxService);
  const bus = app.get(EventBus) as RedisEventBus;

  setInterval(() => { outbox.relayOnce().catch(() => undefined); }, 1000); // outbox relay
  await bus.startConsumer();                                               // event consumer loop
}
bootstrap();
