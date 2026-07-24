import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { AccessService } from './access.service';
import { ProductScopeResolver } from './product-scope.resolver';
import { PermissionGuard } from './permission.guard';
import { RolesService } from './roles.service';
import { MembershipsService } from './memberships.service';
import { AccessController } from './access.controller';

/**
 * Product-wise RBAC. Exports AccessService + PermissionGuard + resolver so other
 * modules (release status, deployments) can enforce @RequirePermission.
 */
@Module({
  imports: [DatabaseModule, JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' })],
  providers: [AccessService, ProductScopeResolver, PermissionGuard, RolesService, MembershipsService],
  controllers: [AccessController],
  exports: [AccessService, ProductScopeResolver, PermissionGuard],
})
export class AccessModule {}
