import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AccessService } from './access.service';
import { RolesService } from './roles.service';
import { MembershipsService } from './memberships.service';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly roles: RolesService,
    private readonly memberships: MembershipsService,
  ) {}

  // ── Introspection (any authenticated user) ──
  @Get('me/permissions')
  async myPermissions(@Req() req: any, @Query('product') productId?: string) {
    const perms = productId
      ? [...(await this.access.effective(req.user.sub, productId))]
      : await this.access.allEffective(req.user.sub);
    return { superuser: await this.access.isSuperuser(req.user.sub), permissions: perms };
  }

  @Get('permissions')
  @RequirePermission('permission.read')
  permissions() { return this.roles.permissions(); }

  // ── Roles (role.manage) ──
  @Get('roles')
  @RequirePermission('permission.read')
  listRoles() { return this.roles.roles(); }

  @Post('roles')
  @RequirePermission('role.manage')
  createRole(@Body() dto: any) { return this.roles.create(dto); }

  @Put('roles/:id/permissions')
  @RequirePermission('role.manage')
  setPerms(@Param('id') id: string, @Body() dto: { permission_keys: string[] }) {
    return this.roles.setPermissions(id, dto.permission_keys || []);
  }

  @Delete('roles/:id')
  @RequirePermission('role.manage')
  removeRole(@Param('id') id: string) { return this.roles.remove(id); }

  // ── Memberships ──
  @Get('products/:id/members')
  @RequirePermission('member.manage')
  members(@Param('id') id: string) { return this.memberships.forProduct(id); }

  @Post('products/:id/members')
  @RequirePermission('member.manage')
  addMember(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.memberships.grant({ ...dto, scope_type: 'product', product_id: id }, req.user?.sub);
  }

  @Get('users/:id/memberships')
  @RequirePermission('member.manage')
  userMemberships(@Param('id') id: string) { return this.memberships.forUser(id); }

  @Post('memberships')
  @RequirePermission('role.manage')  // global grants require the higher privilege
  grant(@Body() dto: any, @Req() req: any) { return this.memberships.grant(dto, req.user?.sub); }

  @Delete('memberships/:id')
  @RequirePermission('member.manage')
  revoke(@Param('id') id: string) { return this.memberships.revoke(id); }
}
