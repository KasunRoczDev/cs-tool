import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { DeploymentsService } from './deployments.service';

class DeployDto {
  @IsString() channel!: string; // canary|beta|production|enterprise
  // Target monitored servers to run the pipeline on (agent-executed).
  @IsOptional() @IsArray() server_ids?: string[];
  // Branch to deploy (overrides each repo's pinned branch).
  @IsOptional() @IsString() branch?: string;
  // Extra shell commands run after the fixed pipeline.
  @IsOptional() @IsArray() custom_commands?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller()
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Get('channels')
  channels() {
    return this.deployments.listChannels();
  }

  @Get('deployments')
  list() {
    return this.deployments.list();
  }

  @Get('deployments/board')
  board() {
    return this.deployments.board();
  }

  @Get('deployments/:id/history')
  history(@Param('id') id: string) {
    return this.deployments.history(id);
  }

  @Get('deployments/:id/jobs')
  jobs(@Param('id') id: string) {
    return this.deployments.listJobs(id);
  }

  @Get('deploy-jobs/:id/log')
  jobLog(@Param('id') id: string) {
    return this.deployments.jobLog(id);
  }

  @Roles('admin', 'operator')
  @Post('releases/:id/deployments')
  deploy(@Param('id') id: string, @Body() dto: DeployDto, @Req() req: any) {
    return this.deployments.deploy(id, dto, req.user?.sub, req.user?.role);
  }

  @Roles('admin', 'operator')
  @Post('deployments/:id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.deployments.approve(id, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Post('deployments/:id/rollback')
  rollback(@Param('id') id: string, @Req() req: any) {
    return this.deployments.rollback(id, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Post('deployments/:id/cancel')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.deployments.cancel(id, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Post('deployments/:id/retry')
  retry(@Param('id') id: string, @Req() req: any) {
    return this.deployments.retry(id, req.user?.sub);
  }
}
