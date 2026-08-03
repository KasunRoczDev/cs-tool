import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
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
  // Deploy at a future time instead of immediately (ISO datetime).
  @IsOptional() @IsString() scheduled_at?: string;
  // Rollout strategy across the selected servers (default: all_at_once).
  @IsOptional() @IsIn(['all_at_once', 'rolling', 'canary']) strategy?: string;
  // rolling: { batch_size }. canary: { canary_count }.
  @IsOptional() @IsObject() strategy_config?: Record<string, any>;
}

class CreateRecurringDeploymentDto {
  @IsString() release_id!: string;
  @IsString() channel!: string;
  @IsOptional() @IsArray() server_ids?: string[];
  @IsOptional() @IsIn(['daily', 'weekly']) interval_type?: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) day_of_week?: number;
  @Matches(/^\d{2}:\d{2}$/) time_of_day!: string; // 'HH:MM', UTC
  @IsOptional() @IsIn(['all_at_once', 'rolling', 'canary']) strategy?: string;
  @IsOptional() @IsObject() strategy_config?: Record<string, any>;
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

  @Get('deployments/metrics')
  metrics(@Query('channel') channel?: string, @Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : undefined;
    return this.deployments.metrics(channel || undefined, Number.isFinite(n) ? n : undefined);
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

  @Roles('admin', 'operator')
  @Post('deployments/:id/promote-wave')
  promoteWave(@Param('id') id: string, @Req() req: any) {
    return this.deployments.promoteWave(id, req.user?.sub);
  }

  @Get('recurring-deployments')
  listRecurring(@Query('release_id') releaseId?: string) {
    return this.deployments.listRecurringDeployments(releaseId);
  }

  @Roles('admin', 'operator')
  @Post('recurring-deployments')
  createRecurring(@Body() dto: CreateRecurringDeploymentDto, @Req() req: any) {
    return this.deployments.createRecurringDeployment(dto, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Post('recurring-deployments/:id/enable')
  enableRecurring(@Param('id') id: string) {
    return this.deployments.setRecurringDeploymentEnabled(id, true);
  }

  @Roles('admin', 'operator')
  @Post('recurring-deployments/:id/disable')
  disableRecurring(@Param('id') id: string) {
    return this.deployments.setRecurringDeploymentEnabled(id, false);
  }

  @Roles('admin', 'operator')
  @Delete('recurring-deployments/:id')
  deleteRecurring(@Param('id') id: string) {
    return this.deployments.deleteRecurringDeployment(id);
  }
}
