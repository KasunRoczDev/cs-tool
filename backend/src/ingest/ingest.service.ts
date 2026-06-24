import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { MetricDto, SecurityEventDto } from './dto';

@Injectable()
export class IngestService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly rt: RealtimeGateway,
    private readonly engine: AlertEngineService,
  ) {}

  private async touch(serverId: string) {
    await this.pool.query(
      `UPDATE servers SET last_seen = now(),
              status = 'online'
        WHERE id = $1`,
      [serverId],
    );
  }

  async ingestMetrics(serverId: string, metrics: MetricDto[]) {
    await this.touch(serverId);
    for (const m of metrics) {
      const ts = m.timestamp ? new Date(m.timestamp) : new Date();
      await this.pool.query(
        `INSERT INTO metrics
          (server_id, time, cpu_usage, memory_usage, disk_usage, net_in, net_out, load_avg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [serverId, ts, m.cpu, m.memory, m.disk, m.net_in, m.net_out, m.load_avg],
      );
      const sample = {
        server_id: serverId,
        time: ts,
        cpu_usage: m.cpu,
        memory_usage: m.memory,
        disk_usage: m.disk,
        net_in: m.net_in,
        net_out: m.net_out,
      };
      this.rt.emitMetric(serverId, sample);
      await this.engine.evaluateMetric(serverId, sample);
    }
    return { accepted: metrics.length };
  }

  async ingestSecurityEvents(serverId: string, events: SecurityEventDto[]) {
    await this.touch(serverId);
    for (const e of events) {
      const ts = e.timestamp ? new Date(e.timestamp) : new Date();
      // 'info' maps to 'low' for DB enum compatibility
      const dbSeverity = (e.severity === 'info' ? 'low' : e.severity) ?? 'low';
      const { rows } = await this.pool.query(
        `INSERT INTO security_events
          (server_id, time, event_type, severity, source_ip, username, message, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          serverId,
          ts,
          e.event_type,
          dbSeverity,
          e.source_ip ?? null,
          e.username ?? null,
          e.message ?? null,
          e.raw != null ? JSON.stringify(e.raw) : null,
        ],
      );
      this.rt.emitSecurityEvent(serverId, rows[0]);
      await this.engine.evaluateSecurityEvent(serverId, {
        event_type: e.event_type,
        severity: dbSeverity,
        message: e.message,
        raw: e.raw ?? null,
      });
    }
    return { accepted: events.length };
  }
}
