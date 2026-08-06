import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BillingReportService } from './billing-report.service';

@UseGuards(JwtAuthGuard)
@Controller('billing/report')
export class BillingReportController {
  constructor(private readonly report: BillingReportService) {}

  @Get()
  get(
    @Query('month') month: string,
    @Query('product_id') productId?: string,
    @Query('service_type_id') typeId?: string,
    @Query('provider') provider?: string,
  ) {
    return this.report.report(month, { product_id: productId, service_type_id: typeId, provider });
  }
}
