import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
  @IsIn(['admin', 'operator', 'viewer']) role!: string;
}
class SetRoleDto {
  @IsIn(['admin', 'operator', 'viewer']) role!: string;
}
class SetPasswordDto {
  @IsString() @MinLength(6) password!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ---- admin-only management ----
  @Roles('admin')
  @Get()
  list() {
    return this.users.list();
  }

  @Roles('admin')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateUserDto) {
    const u = await this.users.create(dto.email, dto.password, dto.role);
    await this.users.audit(req.user.sub, 'user.create', u.id, { email: u.email, role: u.role });
    return u;
  }

  @Roles('admin')
  @Patch(':id/role')
  async setRole(@Req() req: any, @Param('id') id: string, @Body() dto: SetRoleDto) {
    const u = await this.users.setRole(id, dto.role);
    await this.users.audit(req.user.sub, 'user.setRole', id, { role: dto.role });
    return u;
  }

  @Roles('admin')
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const r = await this.users.remove(id, req.user.sub);
    await this.users.audit(req.user.sub, 'user.delete', id, null);
    return r;
  }

  // ---- self-service: change your own password ----
  @Patch('me/password')
  changeOwnPassword(@Req() req: any, @Body() dto: SetPasswordDto) {
    return this.users.setPassword(req.user.sub, dto.password);
  }

  // ---- admin: reset anyone's password ----
  @Roles('admin')
  @Patch(':id/password')
  setPassword(@Param('id') id: string, @Body() dto: SetPasswordDto) {
    return this.users.setPassword(id, dto.password);
  }
}
