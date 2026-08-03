import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ApprovalsService } from './approvals.service';

class CreateDelegationDto {
  // Omit to delegate your own approvals; only an admin may set someone else's.
  @IsOptional() @IsString() from_user?: string;
  @IsString() to_user!: string;
  @IsDateString() ends_at!: string;
  @IsOptional() @IsString() reason?: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('releases/:id/approvals')
  status(@Param('id') id: string) {
    return this.approvals.status(id);
  }

  @Get('releases/:id/approvals/history')
  history(@Param('id') id: string) {
    return this.approvals.history(id);
  }

  /** Submit a decision with optional remark + a single attachment (multipart). */
  @Post('releases/:id/approvals')
  @UseInterceptors(FileInterceptor('file'))
  submit(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { decision?: string; remark?: string },
    @UploadedFile() file?: any,
  ) {
    return this.approvals.submit(id, req.user.sub, body, file);
  }

  @Roles('admin', 'operator')
  @Post('releases/:id/approvals/:approverId/re-request')
  reRequest(@Param('id') id: string, @Param('approverId') approverId: string, @Req() req: any) {
    return this.approvals.reRequestApproval(id, approverId, req.user.sub);
  }

  @Get('approval-attachments/:id')
  async download(@Param('id') id: string, @Res() res: Response) {
    const a = await this.approvals.attachment(id);
    res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${a.filename}"`);
    res.send(a.data);
  }

  @Get('approval-delegations')
  listDelegations(@Query('user_id') userId: string | undefined, @Req() req: any) {
    // Non-admins only ever see delegations involving themselves.
    return this.approvals.listDelegations(req.user.role === 'admin' ? userId : req.user.sub);
  }

  @Post('approval-delegations')
  createDelegation(@Body() dto: CreateDelegationDto, @Req() req: any) {
    return this.approvals.createDelegation(
      dto.from_user || req.user.sub, dto.to_user, dto.ends_at, dto.reason, req.user.sub, req.user.role,
    );
  }

  @Delete('approval-delegations/:id')
  revokeDelegation(@Param('id') id: string, @Req() req: any) {
    return this.approvals.revokeDelegation(id, req.user.sub, req.user.role);
  }
}
