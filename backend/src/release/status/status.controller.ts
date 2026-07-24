import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { StatusService } from './status.service';

class TransitionDto {
  @IsString() to_status_key!: string;
  @IsOptional() @IsString() note?: string;
}

@UseGuards(JwtAuthGuard)
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
}
