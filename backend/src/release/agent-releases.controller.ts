import {
  Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AgentReleasesService } from './agent-releases.service';

class PublishAgentReleaseDto {
  @IsString() version!: string;
  @IsOptional() @IsString() changelog?: string;
  @IsString() signature!: string;
  // Arrives as a string over multipart form-data; parsed to a number below.
  @IsOptional() @IsString() rollout_percent?: string;
}

class UpdateAgentReleaseDto {
  @IsOptional() rollout_percent?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('agent-releases')
export class AgentReleasesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get()
  @RequirePermission('settings.manage')
  list() {
    return this.releases.list();
  }

  /** Publish a new agent release: the .deb (multipart field "package") plus its offline-computed Ed25519 signature. */
  @Post()
  @RequirePermission('settings.manage')
  @UseInterceptors(FileInterceptor('package', { limits: { fileSize: 50 * 1024 * 1024 } }))
  publish(@Body() dto: PublishAgentReleaseDto, @UploadedFile() file: any, @Req() req: any) {
    return this.releases.publish({
      version: dto.version,
      changelog: dto.changelog,
      package: file?.buffer,
      signature: dto.signature,
      rollout_percent: dto.rollout_percent !== undefined ? Number(dto.rollout_percent) : undefined,
      created_by: req.user?.sub,
    });
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@Param('id') id: string, @Body() dto: UpdateAgentReleaseDto) {
    return this.releases.updateRollout(id, dto);
  }
}
