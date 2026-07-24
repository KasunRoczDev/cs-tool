import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { PermissionGuard } from '../../common/rbac/permission.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permissions, channelApprovePermission } from '../../common/rbac/permissions';

const ctxOf = (req: any) => ({
  actor: { id: req.user?.id, email: req.user?.email },
  trace: { requestId: req.id, ip: req.ip, userAgent: req.headers['user-agent'] },
});
const rolesOf = (req: any): string[] => req.user?.roles ?? [];

@Controller('api/v1/releases')
@UseGuards(PermissionGuard)
export class ReleaseController {
  constructor(private readonly svc: ReleaseService) {}

  @Post()
  @RequirePermission(Permissions.ReleaseCreate)
  create(@Req() req: any, @Body() dto: any) { return this.svc.create(ctxOf(req), dto); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post(':id/repositories')
  @RequirePermission(Permissions.ReleaseEdit)
  addRepo(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.addRepository(ctxOf(req), id, dto); }

  @Get(':id/preflight')
  preflight(@Req() req: any, @Param('id') id: string) {
    // channel inferred client-side; default to next-from-draft for demo
    return this.svc.runPreflight(id, 'canary', rolesOf(req));
  }

  @Post(':id/promote')
  // NB: the concrete channel permission is enforced inside the handler dynamically
  promote(@Req() req: any, @Param('id') id: string, @Body() dto: { to_channel: string }) {
    const required = channelApprovePermission(dto.to_channel);
    if (!(req.user?.permissions ?? []).includes(required)) {
      throw new (require('../../common/errors/app-error').AppError)('forbidden', `Missing permission: ${required}`, 403);
    }
    return this.svc.promote(ctxOf(req), id, dto.to_channel, rolesOf(req));
  }

  @Post(':id/rollback')
  @RequirePermission(Permissions.DeployRollback)
  rollback(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.rollback(ctxOf(req), id, dto.to_release_id, dto.reason);
  }
}
