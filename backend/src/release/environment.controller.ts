import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { EnvironmentService } from './environment.service';

class UpsertEnvVarDto {
  @IsString() key!: string;
  @IsString() value!: string;
  @IsOptional() @IsBoolean() is_secret?: boolean;
  @IsOptional() @IsString() product_id?: string;
}

class LockChannelDto {
  @IsOptional() @IsString() reason?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('channels')
export class EnvironmentController {
  constructor(private readonly env: EnvironmentService) {}

  @Get(':id/env-vars')
  list(@Param('id') id: string) {
    return this.env.listEnvVars(id);
  }

  @Post(':id/env-vars')
  @RequirePermission('settings.manage')
  upsert(@Param('id') id: string, @Body() dto: UpsertEnvVarDto) {
    return this.env.upsertEnvVar(id, dto);
  }

  @Delete(':id/env-vars/:varId')
  @RequirePermission('settings.manage')
  remove(@Param('id') id: string, @Param('varId') varId: string) {
    return this.env.deleteEnvVar(id, varId);
  }

  @Get('compare-env')
  compare(@Query('a') a: string, @Query('b') b: string) {
    return this.env.compareChannels(a, b);
  }

  @Roles('admin', 'operator')
  @Post(':id/lock')
  lock(@Param('id') id: string, @Body() dto: LockChannelDto, @Req() req: any) {
    return this.env.lockChannel(id, dto.reason, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Post(':id/unlock')
  unlock(@Param('id') id: string) {
    return this.env.unlockChannel(id);
  }
}
