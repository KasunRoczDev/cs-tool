import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../access/permission.guard';
import { RequirePermission } from '../../access/require-permission.decorator';
import { StatusService } from './status.service';

class TransitionDto {
  @IsString() to_status_key!: string;
  @IsOptional() @IsString() note?: string;
}

class CreateWorkflowDto {
  @IsString() name!: string;
  @IsString() product_id!: string;
}
class UpdateWorkflowDto {
  @IsOptional() @IsString() name?: string;
}
class CreateStatusDto {
  @IsString() key!: string;
  @IsString() name!: string;
  @IsNumber() rank!: number;
  @IsOptional() @IsIn(['draft', 'stage', 'terminal']) category?: string;
  @IsOptional() @IsString() channel_key?: string;
  @IsOptional() @IsString() color?: string;
}
class UpdateStatusDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() rank?: number;
  @IsOptional() @IsIn(['draft', 'stage', 'terminal']) category?: string;
  @IsOptional() @IsString() channel_key?: string;
  @IsOptional() @IsString() color?: string;
}
class CreateTransitionDto {
  @IsOptional() @IsString() from_status_key?: string;
  @IsString() to_status_key!: string;
  @IsOptional() @IsIn(['forward', 'rollback', 'archive']) kind?: string;
  @IsOptional() @IsBoolean() require_approval?: boolean;
  @IsOptional() @IsArray() required_checks?: string[];
  @IsOptional() @IsString() required_permission?: string;
  @IsOptional() @IsBoolean() auto_deploy?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get('workflows')
  workflows() { return this.status.workflows(); }

  @Get('release-board')
  board() { return this.status.board(); }

  @Get('releases/:id/status')
  view(@Param('id') id: string, @Req() req: any) {
    return this.status.statusView(id, req.user.sub);
  }

  @Get('releases/:id/status-history')
  history(@Param('id') id: string) { return this.status.history(id); }

  // Permission is dynamic (status.transition.<key>) so it's enforced in the service.
  @Post('releases/:id/transition')
  transition(@Param('id') id: string, @Req() req: any, @Body() dto: TransitionDto) {
    return this.status.transition(id, req.user.sub, req.user?.role, dto.to_status_key, dto.note);
  }

  // ── Workflow configuration (settings.manage) ──────────────────────────────
  @Post('workflows')
  @RequirePermission('settings.manage')
  createWorkflow(@Body() dto: CreateWorkflowDto) { return this.status.createWorkflow(dto); }

  @Get('workflows/:id')
  @RequirePermission('settings.manage')
  workflowDetail(@Param('id') id: string) { return this.status.workflowDetail(id); }

  @Patch('workflows/:id')
  @RequirePermission('settings.manage')
  updateWorkflow(@Param('id') id: string, @Body() dto: UpdateWorkflowDto) { return this.status.updateWorkflow(id, dto); }

  @Delete('workflows/:id')
  @RequirePermission('settings.manage')
  deleteWorkflow(@Param('id') id: string) { return this.status.deleteWorkflow(id); }

  @Post('workflows/:id/statuses')
  @RequirePermission('settings.manage')
  createStatus(@Param('id') id: string, @Body() dto: CreateStatusDto) { return this.status.createStatus(id, dto); }

  @Patch('workflows/:id/statuses/:statusId')
  @RequirePermission('settings.manage')
  updateStatus(@Param('id') id: string, @Param('statusId') statusId: string, @Body() dto: UpdateStatusDto) {
    return this.status.updateStatus(id, statusId, dto);
  }

  @Delete('workflows/:id/statuses/:statusId')
  @RequirePermission('settings.manage')
  deleteStatus(@Param('id') id: string, @Param('statusId') statusId: string) {
    return this.status.deleteStatus(id, statusId);
  }

  @Post('workflows/:id/transitions')
  @RequirePermission('settings.manage')
  createTransition(@Param('id') id: string, @Body() dto: CreateTransitionDto) {
    return this.status.createTransition(id, dto);
  }

  @Delete('workflows/:id/transitions/:transitionId')
  @RequirePermission('settings.manage')
  deleteTransition(@Param('id') id: string, @Param('transitionId') transitionId: string) {
    return this.status.deleteTransition(id, transitionId);
  }
}
