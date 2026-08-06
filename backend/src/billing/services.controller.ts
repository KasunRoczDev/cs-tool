import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServicesService, BillingMode } from './services.service';

class CreateServiceDto {
  @IsUUID() product_id!: string;
  @IsUUID() service_type_id!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsArray() specs?: { key: string; value: string }[];
  @IsOptional() @IsIn(['pay_per_use', 'monthly', 'annual']) billing_mode?: BillingMode;
  @IsOptional() @IsUUID() server_id?: string;
  @IsOptional() @IsObject() tags?: Record<string, string>;
}
class UpdateServiceDto {
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() service_type_id?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsArray() specs?: { key: string; value: string }[];
  @IsOptional() @IsIn(['pay_per_use', 'monthly', 'annual']) billing_mode?: BillingMode;
  @IsOptional() @IsUUID() server_id?: string;
  @IsOptional() @IsObject() tags?: Record<string, string>;
}
class SyncServersDto {
  @IsUUID() service_type_id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('billing/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(
    @Query('product_id') productId?: string,
    @Query('service_type_id') typeId?: string,
    @Query('status') status?: string,
  ) {
    return this.services.list({ product_id: productId, service_type_id: typeId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateServiceDto, @Req() req: any) {
    return this.services.create(dto, req.user.sub);
  }

  @Roles('admin', 'operator')
  @Post('sync-servers')
  syncFromServers(@Body() dto: SyncServersDto, @Req() req: any) {
    return this.services.syncFromServers(dto.service_type_id, req.user.sub);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(id, dto);
  }

  @Roles('admin', 'operator')
  @Post(':id/retire')
  retire(@Param('id') id: string) {
    return this.services.setStatus(id, 'retired');
  }

  @Roles('admin', 'operator')
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.services.setStatus(id, 'active');
  }
}
