import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('release-dashboard')
  overview(@Query('product_id') productId?: string) {
    return this.dashboard.overview(productId || undefined);
  }
}
