import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ServersModule } from './servers/servers.module';
import { IngestModule } from './ingest/ingest.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    ServersModule,
    IngestModule,
    AlertsModule,
  ],
})
export class AppModule {}
