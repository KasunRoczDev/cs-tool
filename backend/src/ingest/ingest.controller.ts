import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentAuthGuard } from '../common/agent-auth.guard';
import { IngestService } from './ingest.service';
import { MetricDto, SecurityEventDto } from './dto';

/** Endpoints used by the Ubuntu agent. Authenticated via X-Api-Key. */
@UseGuards(AgentAuthGuard)
@Controller()
export class IngestController {
  private readonly log = new Logger('Ingest');

  constructor(private readonly ingest: IngestService) {}

  // Accepts either a single metric object or { metrics: [...] }.
  @Post('metrics')
  async metrics(@Req() req: any, @Body() body: any) {
    const list = await this.validateBatch(body, 'metrics', MetricDto);
    return this.ingest.ingestMetrics(req.server.id, list);
  }

  @Post('security-events')
  async securityEvents(@Req() req: any, @Body() body: any) {
    const list = await this.validateBatch(body, 'events', SecurityEventDto);
    return this.ingest.ingestSecurityEvents(req.server.id, list);
  }

  // `body` is typed `any` because it's shaped either { <key>: [...] } or a bare item —
  // a union DTO type here silently skips Nest's automatic validation (its emitted
  // metadata collapses to `Object`), so validate explicitly against whichever shape
  // was actually sent.
  //
  // Invalid items are dropped rather than failing the whole request: agents send
  // large batches after a reconnect (offline buffering), and one malformed item
  // must not permanently block everything queued behind it — the agent retries a
  // failed batch unchanged, so a hard-reject on one bad item would wedge forever.
  private async validateBatch<T extends object>(
    body: any,
    key: string,
    cls: new () => T,
  ): Promise<T[]> {
    const raw = body && typeof body === 'object' && Array.isArray(body[key]) ? body[key] : [body];
    if (!raw.length) throw new BadRequestException(`${key} must be a non-empty array`);
    const instances = plainToInstance(cls, raw);
    const valid: T[] = [];
    for (const item of instances) {
      const errors = await validate(item, { whitelist: true, forbidNonWhitelisted: false });
      if (errors.length) {
        this.log.warn(
          `dropping malformed ${key} item: ` +
            errors.map((e) => Object.values(e.constraints ?? {}).join('; ')).join(' | '),
        );
        continue;
      }
      valid.push(item);
    }
    if (!valid.length) throw new BadRequestException(`no valid ${key} in request`);
    return valid;
  }
}
