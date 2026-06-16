import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServersService } from './servers.service';

class RegisterDto {
  @IsString() name!: string;
  @IsOptional() @IsString() hostname?: string;
  @IsOptional() @IsString() ip_address?: string;
  @IsOptional() @IsString() os?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list() {
    return this.servers.list();
  }

  @Get('overview')
  overview() {
    return this.servers.overview();
  }

  @Roles('admin', 'operator')
  @Post()
  register(@Body() dto: RegisterDto) {
    return this.servers.register(dto.name, dto.hostname, dto.ip_address, dto.os);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.servers.get(id);
  }

  @Get(':id/metrics')
  metrics(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.servers.metrics(id, from, to);
  }

  @Get(':id/security-events')
  securityEvents(
    @Param('id') id: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.servers.securityEvents(id, type, limit ? Number(limit) : 200);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servers.remove(id);
  }
}
