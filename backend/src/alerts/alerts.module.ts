import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertEngineService } from './alert-engine.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    NotificationsModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEngineService],
  exports: [AlertEngineService],
})
export class AlertsModule {}
