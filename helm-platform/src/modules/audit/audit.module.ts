import { Module } from '@nestjs/common';
import { AuditConsumer } from './audit.consumer';
import { PrismaService } from '../../common/prisma.service';
import { EventsModule } from '../../common/events/events.module';

@Module({ imports: [EventsModule], providers: [AuditConsumer, PrismaService] })
export class AuditModule {}
