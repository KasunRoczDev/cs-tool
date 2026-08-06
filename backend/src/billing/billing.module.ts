import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BillingRecordsService } from './billing-records.service';
import { BillingRecordsController } from './billing-records.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [ServiceTypesService, ServicesService, BillingRecordsService],
  controllers: [ServiceTypesController, ServicesController, BillingRecordsController],
  exports: [ServiceTypesService, ServicesService, BillingRecordsService],
})
export class BillingModule {}
