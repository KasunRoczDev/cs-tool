import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declare the permission an endpoint needs. Enforced by PermissionGuard, which
 * resolves the product scope and checks the caller's effective permissions.
 *   @RequirePermission('release.promote')
 */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);
