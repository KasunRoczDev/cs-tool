import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import {
  CreateChannelDto, UpdateChannelDto,
  CreateRuleDto, UpdateRuleDto,
  TestChannelDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  // ── Channels ──────────────────────────────────────────────────────────────

  @Get('channels')
  listChannels() { return this.svc.listChannels(); }

  @Post('channels')
  createChannel(@Body() dto: CreateChannelDto, @Req() req: any) {
    return this.svc.createChannel(dto, req.user.sub);
  }

  @Patch('channels/:id')
  updateChannel(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.svc.updateChannel(id, dto);
  }

  @Delete('channels/:id')
  deleteChannel(@Param('id') id: string) {
    return this.svc.deleteChannel(id);
  }

  // ── Test ─────────────────────────────────────────────────────────────────

  @Post('channels/:id/test')
  testChannel(@Param('id') id: string) {
    return this.svc.testChannel(id);
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  @Get('rules')
  listRules(@Query('channelId') channelId?: string) {
    return this.svc.listRules(channelId);
  }

  @Post('rules')
  createRule(@Body() dto: CreateRuleDto) {
    return this.svc.createRule(dto);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return this.svc.updateRule(id, dto);
  }

  @Delete('rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.svc.deleteRule(id);
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  @Get('log')
  log(@Query('limit') limit?: string) {
    return this.svc.listLog(limit ? Number(limit) : 100);
  }
}
