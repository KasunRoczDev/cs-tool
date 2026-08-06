import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServiceTypesService } from './service-types.service';

class CreateServiceTypeDto {
  @IsString() key!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateServiceTypeDto {
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('billing/service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypes: ServiceTypesService) {}

  @Get()
  list() {
    return this.serviceTypes.list();
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateServiceTypeDto) {
    return this.serviceTypes.create(dto.key, dto.name, dto.description);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceTypeDto) {
    return this.serviceTypes.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceTypes.remove(id);
  }
}
