import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from './access.service';
import { ProductScopeResolver } from './product-scope.resolver';
import { PERMISSION_KEY } from './require-permission.decorator';

/**
 * Enforces @RequirePermission. Runs after JwtAuthGuard (req.user populated).
 * Resolves the request's product scope and requires the permission on EVERY
 * product in scope (strict). Global/superuser passes. If no scope resolves,
 * the permission is checked at the global level.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly scope: ProductScopeResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true; // endpoint not permission-gated

    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException({ error: { code: 'unauthenticated' } });

    if (await this.access.isSuperuser(userId)) return true;

    const products = await this.scope.resolve(req);
    const deny = () => {
      throw new ForbiddenException({
        error: { code: 'forbidden', message: `Missing permission: ${required}`, required },
      });
    };

    if (products.length === 0) {
      if (!(await this.access.can(userId, required))) deny();
      return true;
    }
    for (const productId of products) {
      if (!(await this.access.can(userId, required, productId))) deny();
    }
    return true;
  }
}
