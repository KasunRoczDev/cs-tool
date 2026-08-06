import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { AppsService } from './apps.service';

class CreateAppDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() repository_id?: string;
}
class UpdateAppDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() repository_id?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  list() {
    return this.apps.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.apps.get(id);
  }

  @Get(':id/servers')
  listServers(@Param('id') id: string) {
    return this.apps.listServers(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateAppDto, @Req() req: any) {
    return this.apps.create(dto, req.user.sub);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.apps.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apps.remove(id);
  }
}
