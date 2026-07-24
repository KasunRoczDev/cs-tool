import {
  Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ApprovalsService } from './approvals.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('releases/:id/approvals')
  status(@Param('id') id: string) {
    return this.approvals.status(id);
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

  @Get('approval-attachments/:id')
  async download(@Param('id') id: string, @Res() res: Response) {
    const a = await this.approvals.attachment(id);
    res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${a.filename}"`);
    res.send(a.data);
  }
}
