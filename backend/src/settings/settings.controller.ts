import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { SettingsService } from './settings.service';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  /** GET /api/v1/settings — returns all settings (passwords masked). */
  @Get()
  getAll() {
    return this.svc.getAll();
  }

  /** PATCH /api/v1/settings — upsert one or more settings. Admin only. */
  @Patch()
  setMany(@Body() body: Record<string, string>, @Req() req: any) {
    // Only admins may change settings
    if (req.user?.role !== 'admin') {
      throw new Error('Forbidden');
    }
    return this.svc.setMany(body, req.user.sub);
  }
}
