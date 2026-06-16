import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { AlertsService } from './alerts.service';

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.alerts.list(status);
  }

  @Roles('admin', 'operator')
  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.alerts.resolve(id);
  }
}
