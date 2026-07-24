import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { AgentAuthGuard } from '../common/agent-auth.guard';
import { DeploymentsService } from './deployments.service';

class JobResultDto {
  @IsIn(['running', 'succeeded', 'failed']) status!: 'running' | 'succeeded' | 'failed';
  @IsOptional() @IsArray() steps?: any[];
  @IsOptional() @IsString() log?: string;
  @IsOptional() @IsString() error?: string;
}

/**
 * Endpoints used by the on-server monitoring agent to run deployments.
 * Authenticated with the same X-Api-Key as metric ingest (→ req.server).
 *
 *   POST /agent/deploy-jobs/claim        → claim this server's pending jobs
 *   POST /agent/deploy-jobs/:id/result   → report a job's running/final result
 */
@UseGuards(AgentAuthGuard)
@Controller('agent/deploy-jobs')
export class DeployAgentController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Post('claim')
  claim(@Req() req: any) {
    return this.deployments.claimJobsForServer(req.server.id);
  }

  @Post(':id/result')
  result(@Param('id') id: string, @Req() req: any, @Body() dto: JobResultDto) {
    return this.deployments.reportJobResult(id, req.server.id, dto);
  }
}
