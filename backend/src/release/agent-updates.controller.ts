import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { AgentAuthGuard } from '../common/agent-auth.guard';
import { AgentReleasesService } from './agent-releases.service';

class ReportUpdateDto {
  @IsString() version!: string;
  @IsIn(['applying', 'succeeded', 'rolled_back', 'failed']) status!: string;
  @IsOptional() @IsString() message?: string;
}

/**
 * Endpoints used by the on-server monitoring agent to self-update.
 * Authenticated with the same X-Api-Key as metric ingest and deploy jobs.
 *
 *   GET  /agent/updates/latest          -> eligibility + version/sha256/signature
 *   GET  /agent/updates/:version/package -> the .deb bytes
 *   POST /agent/updates/report          -> report the outcome of applying an update
 */
@UseGuards(AgentAuthGuard)
@Controller('agent/updates')
export class AgentUpdatesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get('latest')
  latest(@Req() req: any) {
    return this.releases.latestFor(req.server.id);
  }

  @Get(':version/package')
  async package(@Param('version') version: string, @Res() res: Response) {
    const buf = await this.releases.getPackage(version);
    res.setHeader('Content-Type', 'application/vnd.debian.binary-package');
    res.send(buf);
  }

  @Post('report')
  report(@Req() req: any, @Body() dto: ReportUpdateDto) {
    return this.releases.reportUpdate(req.server.id, dto);
  }
}
