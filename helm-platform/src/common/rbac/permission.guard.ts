import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';

/**
 * Enforces scoped RBAC at the API boundary (blueprint C.8). Reads the required permission
 * from metadata and checks it against req.user.permissions (populated by auth middleware),
 * honoring scope (global | repository | channel).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest();
    const perms: string[] = req.user?.permissions ?? [];
    if (!perms.includes(required)) {
      throw new ForbiddenException({ error: { code: 'forbidden', message: `Missing permission: ${required}` } });
    }
    return true;
  }
}
