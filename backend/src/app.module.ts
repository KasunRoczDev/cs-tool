import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ServersModule } from './servers/servers.module';
import { ProductsModule } from './products/products.module';
import { IngestModule } from './ingest/ingest.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SecurityModule } from './security/security.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { AnalysisModule } from './analysis/analysis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    ServersModule,
    ProductsModule,
    IngestModule,
    AlertsModule,
    SecurityModule,
    NotificationsModule,
    SettingsModule,
    AnalysisModule,
  ],
})
export class AppModule {}
