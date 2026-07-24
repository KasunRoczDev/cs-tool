import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventsModule } from './common/events/events.module';
import { PrismaService } from './common/prisma.service';
import { HealthController } from './common/health.controller';
import { PermissionGuard } from './common/rbac/permission.guard';
import { GitProviderModule } from './modules/git-provider/git-provider.module';
import { RepositoryModule } from './modules/repository/repository.module';
import { ReleaseModule } from './modules/release/release.module';
import { WorkItemModule } from './modules/workitem/workitem.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventsModule,
    GitProviderModule,
    RepositoryModule,
    ReleaseModule,
    WorkItemModule,
    WebhookModule,
    AuditModule,
    NotificationModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_GUARD, useClass: PermissionGuard }],
})
export class AppModule {}
