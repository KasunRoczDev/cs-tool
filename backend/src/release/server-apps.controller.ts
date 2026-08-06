import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServerAppsService } from './server-apps.service';

class LinkServerAppDto {
  @IsUUID() app_id!: string;
  @IsOptional() @IsString() nginx_config?: string;
  @IsOptional() @IsString() php_fpm_config?: string;
  @IsOptional() @IsString() php_ini_config?: string;
}
class UpdateServerAppDto {
  @IsOptional() @IsString() nginx_config?: string;
  @IsOptional() @IsString() php_fpm_config?: string;
  @IsOptional() @IsString() php_ini_config?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServerAppsController {
  constructor(private readonly serverApps: ServerAppsService) {}

  @Get(':id/apps')
  list(@Param('id') serverId: string) {
    return this.serverApps.list(serverId);
  }

  @Roles('admin', 'operator')
  @Post(':id/apps')
  link(@Param('id') serverId: string, @Body() dto: LinkServerAppDto) {
    return this.serverApps.link(serverId, dto);
  }

  @Roles('admin', 'operator')
  @Patch(':id/apps/:appId')
  update(@Param('id') serverId: string, @Param('appId') appId: string, @Body() dto: UpdateServerAppDto) {
    return this.serverApps.updateConfig(serverId, appId, dto);
  }

  @Roles('admin', 'operator')
  @Delete(':id/apps/:appId')
  unlink(@Param('id') serverId: string, @Param('appId') appId: string) {
    return this.serverApps.unlink(serverId, appId);
  }
}
