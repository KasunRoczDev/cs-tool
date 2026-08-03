import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AuditService, AuditFilters } from './audit.service';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  private parseFilters(q: Record<string, string>): AuditFilters {
    return {
      release_id: q.release_id || undefined,
      actor_id: q.actor_id || undefined,
      type: q.type || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    };
  }

  @Get()
  @RequirePermission('audit.read')
  list(@Query() q: Record<string, string>) {
    return this.audit.list(this.parseFilters(q));
  }

  @Get('export.csv')
  @RequirePermission('audit.read')
  async exportCsv(@Query() q: Record<string, string>, @Res() res: Response) {
    const rows = await this.audit.list({ ...this.parseFilters(q), limit: 5000 });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="release-audit-log.csv"');
    res.send(this.audit.toCsv(rows));
  }
}
