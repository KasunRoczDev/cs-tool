import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { SecurityService, SecFilters } from './security.service';

@UseGuards(JwtAuthGuard)
@Controller('security')
export class SecurityController {
  constructor(private readonly sec: SecurityService) {}

  private filters(q: any): SecFilters {
    return {
      serverId: q.serverId || undefined,
      type: q.type || undefined,
      severity: q.severity || undefined,
      sourceIp: q.sourceIp || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    };
  }

  @Get('events')
  events(@Query() q: any) {
    return this.sec.events(this.filters(q), q.limit ? Number(q.limit) : 300);
  }

  @Get('stats')
  stats(@Query() q: any) {
    return this.sec.stats(this.filters(q));
  }

  @Get('grouped')
  grouped(@Query() q: any) {
    return this.sec.grouped(this.filters(q), q.limit ? Number(q.limit) : 100);
  }

  @Get('types')
  types() {
    return this.sec.types();
  }
}
