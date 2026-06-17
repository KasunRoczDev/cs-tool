import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AnalysisService } from './analysis.service';

@UseGuards(JwtAuthGuard)
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly svc: AnalysisService) {}

  /** GET /api/v1/analysis — posture for all servers, sorted by score asc */
  @Get()
  all(@Query('window') window?: string) {
    const w = window ? Number(window) : 24;
    return this.svc.analyzeAll(w);
  }

  /** GET /api/v1/analysis/:serverId — detailed posture for one server */
  @Get(':serverId')
  server(
    @Param('serverId') serverId: string,
    @Query('window') window?: string,
  ) {
    const w = window ? Number(window) : 24;
    return this.svc.analyzeServer(serverId, w);
  }
}
