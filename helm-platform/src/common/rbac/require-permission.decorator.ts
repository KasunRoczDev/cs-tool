import { SetMetadata } from '@nestjs/common';
export const PERMISSION_KEY = 'required_permission';
/** Usage: @RequirePermission(Permissions.ReleaseCreate) on a controller handler. */
export const RequirePermission = (perm: string) => SetMetadata(PERMISSION_KEY, perm);
