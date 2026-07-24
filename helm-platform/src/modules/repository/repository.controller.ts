import { Body, Controller, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { PermissionGuard } from '../../common/rbac/permission.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permissions } from '../../common/rbac/permissions';

const ctxOf = (req: any) => ({
  actor: { id: req.user?.id, email: req.user?.email },
  trace: { requestId: req.id, ip: req.ip, userAgent: req.headers['user-agent'] },
});

@Controller('api/v1/repositories')
@UseGuards(PermissionGuard)
export class RepositoryController {
  constructor(private readonly svc: RepositoryService) {}

  @Get()
  list(@Query() q: any) { return this.svc.list({ provider: q.provider, active: q.active, q: q.q }); }

  @Post()
  @RequirePermission(Permissions.RepositoryManage)
  register(@Req() req: any, @Body() dto: any) { return this.svc.register(ctxOf(req), dto); }

  @Post('import')
  @RequirePermission(Permissions.RepositoryManage)
  bulkImport(@Req() req: any, @Body() dto: any) { return this.svc.bulkImport(ctxOf(req), dto); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }
}
