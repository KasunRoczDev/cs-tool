import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BillingDashboardService } from './billing-dashboard.service';
import { BillingInsightsService } from './billing-insights.service';

@UseGuards(JwtAuthGuard)
@Controller('billing/dashboard')
export class BillingDashboardController {
  constructor(
    private readonly dashboard: BillingDashboardService,
    private readonly insights: BillingInsightsService,
  ) {}

  @Get('summary')
  summary(@Query('months') months?: string) {
    return this.dashboard.summary(months ? parseInt(months, 10) : 6);
  }

  @Get('insights')
  getInsights() {
    return this.insights.getInsights();
  }
}
