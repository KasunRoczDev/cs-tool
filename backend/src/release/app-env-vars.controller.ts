import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AppEnvVarsService } from './app-env-vars.service';

class UpsertAppEnvVarDto {
  @IsString() key!: string;
  @IsString() value!: string;
  @IsOptional() @IsBoolean() is_secret?: boolean;
  @IsOptional() @IsString() channel_id?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('apps')
export class AppEnvVarsController {
  constructor(private readonly envVars: AppEnvVarsService) {}

  @Get(':id/env-vars')
  list(@Param('id') appId: string, @Query('channel_id') channelId?: string) {
    return this.envVars.listEnvVars(appId, channelId);
  }

  @Post(':id/env-vars')
  @RequirePermission('settings.manage')
  upsert(@Param('id') appId: string, @Body() dto: UpsertAppEnvVarDto) {
    return this.envVars.upsertEnvVar(appId, dto);
  }

  @Delete(':id/env-vars/:varId')
  @RequirePermission('settings.manage')
  remove(@Param('id') appId: string, @Param('varId') varId: string) {
    return this.envVars.deleteEnvVar(appId, varId);
  }
}
