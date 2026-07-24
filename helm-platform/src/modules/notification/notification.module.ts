import { Module } from '@nestjs/common';
import { NotificationConsumer } from './notification.consumer';
import { PrismaService } from '../../common/prisma.service';
import { EventsModule } from '../../common/events/events.module';

@Module({ imports: [EventsModule], providers: [NotificationConsumer, PrismaService] })
export class NotificationModule {}
