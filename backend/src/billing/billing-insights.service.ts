import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const CPU_THRESHOLD = 15;   // percent
const RAM_THRESHOLD = 20;   // percent
const WINDOW_DAYS = 30;

export interface InsightFlag {
  service_id: string;
  service_name: string;
  server_id: string;
  server_name: string;
  flag: 'downsizing_candidate' | 'possibly_unused';
  avg_cpu: number | null;
  avg_ram: number | null;
  amount: number;
  reason: string;
}

@Injectable()
export class BillingInsightsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getInsights(): Promise<InsightFlag[]> {
    const { rows } = await this.pool.query(
      `SELECT s.id AS service_id, s.name AS service_name,
              sv.id AS server_id, sv.name AS server_name, sv.status AS server_status, sv.last_seen,
              br.amount::float AS amount,
              (SELECT avg(cpu_usage)    FROM metrics_1h WHERE server_id = sv.id AND bucket >= now() - ($1 || ' days')::interval) AS avg_cpu,
              (SELECT avg(memory_usage) FROM metrics_1h WHERE server_id = sv.id AND bucket >= now() - ($1 || ' days')::interval) AS avg_ram
         FROM services s
         JOIN servers sv ON sv.id = s.server_id
         JOIN billing_records br ON br.service_id = s.id
                                 AND br.billing_month = date_trunc('month', now() - interval '1 month')::date
        WHERE s.status = 'active'`,
      [WINDOW_DAYS],
    );

    const flags: InsightFlag[] = [];
    for (const r of rows) {
      if (!(r.amount > 0)) continue;
      const offline =
        r.server_status === 'offline' ||
        (r.last_seen && new Date(r.last_seen).getTime() < Date.now() - WINDOW_DAYS * 86_400_000);
      if (offline) {
        flags.push({
          service_id: r.service_id, service_name: r.service_name,
          server_id: r.server_id, server_name: r.server_name,
          flag: 'possibly_unused', avg_cpu: r.avg_cpu, avg_ram: r.avg_ram, amount: r.amount,
          reason: `Server "${r.server_name}" is offline or hasn't reported in ${WINDOW_DAYS}+ days but is still billed.`,
        });
        continue;
      }
      if (r.avg_cpu != null && r.avg_ram != null && r.avg_cpu < CPU_THRESHOLD && r.avg_ram < RAM_THRESHOLD) {
        flags.push({
          service_id: r.service_id, service_name: r.service_name,
          server_id: r.server_id, server_name: r.server_name,
          flag: 'downsizing_candidate', avg_cpu: r.avg_cpu, avg_ram: r.avg_ram, amount: r.amount,
          reason: `Avg CPU ${r.avg_cpu.toFixed(1)}% / RAM ${r.avg_ram.toFixed(1)}% over ${WINDOW_DAYS} days — consider downsizing.`,
        });
      }
    }
    return flags;
  }
}
