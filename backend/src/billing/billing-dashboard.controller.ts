import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BillingDashboardService, PeriodScope } from './billing-dashboard.service';
import { BillingInsightsService } from './billing-insights.service';

@UseGuards(JwtAuthGuard)
@Controller('billing/dashboard')
export class BillingDashboardController {
  constructor(
    private readonly dashboard: BillingDashboardService,
    private readonly insights: BillingInsightsService,
  ) {}

  @Get('summary')
  summary(
    @Query('months') months?: string,
    @Query('period') period?: string,
    @Query('month') month?: string,
  ) {
    const scope: PeriodScope = period === 'year' || period === 'all' ? period : 'month';
    return this.dashboard.summary(months ? parseInt(months, 10) : 6, scope, month);
  }

  @Get('insights')
  getInsights() {
    return this.insights.getInsights();
  }
}
