import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { CalendarService } from './calendar.service';

class CreateFreezeWindowDto {
  @IsString() name!: string;
  @IsString() starts_at!: string;
  @IsString() ends_at!: string;
  @IsOptional() @IsString() channel_id?: string;
  @IsOptional() @IsString() product_id?: string;
  @IsOptional() @IsString() reason?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('release-calendar')
  get(@Query('from') from: string, @Query('to') to: string) {
    return this.calendar.calendar(from, to);
  }

  @Get('freeze-windows')
  list() {
    return this.calendar.listFreezeWindows();
  }

  @Post('freeze-windows')
  @RequirePermission('settings.manage')
  create(@Body() dto: CreateFreezeWindowDto, @Req() req: any) {
    return this.calendar.createFreezeWindow({ ...dto, created_by: req.user?.sub });
  }

  @Delete('freeze-windows/:id')
  @RequirePermission('settings.manage')
  remove(@Param('id') id: string) {
    return this.calendar.deleteFreezeWindow(id);
  }
}
