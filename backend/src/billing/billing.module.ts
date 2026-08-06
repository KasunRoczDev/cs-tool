import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BillingRecordsService } from './billing-records.service';
import { BillingRecordsController } from './billing-records.controller';
import { BillingDashboardService } from './billing-dashboard.service';
import { BillingInsightsService } from './billing-insights.service';
import { BillingDashboardController } from './billing-dashboard.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    SettingsModule,
  ],
  providers: [
    ServiceTypesService, ServicesService, BillingRecordsService,
    BillingDashboardService, BillingInsightsService,
  ],
  controllers: [
    ServiceTypesController, ServicesController, BillingRecordsController, BillingDashboardController,
  ],
  exports: [ServiceTypesService, ServicesService, BillingRecordsService],
})
export class BillingModule {}
