import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from '../common/agent-auth.guard';
import { IngestService } from './ingest.service';
import {
  MetricDto,
  MetricsBatchDto,
  SecurityEventDto,
  SecurityEventsBatchDto,
} from './dto';

/** Endpoints used by the Ubuntu agent. Authenticated via X-Api-Key. */
@UseGuards(AgentAuthGuard)
@Controller()
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  // Accepts either a single metric object or { metrics: [...] }.
  @Post('metrics')
  metrics(@Req() req: any, @Body() body: MetricsBatchDto | MetricDto) {
    const list = 'metrics' in body ? body.metrics : [body as MetricDto];
    return this.ingest.ingestMetrics(req.server.id, list);
  }

  @Post('security-events')
  securityEvents(
    @Req() req: any,
    @Body() body: SecurityEventsBatchDto | SecurityEventDto,
  ) {
    const list = 'events' in body ? body.events : [body as SecurityEventDto];
    return this.ingest.ingestSecurityEvents(req.server.id, list);
  }
}
