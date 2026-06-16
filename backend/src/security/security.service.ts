import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface SecFilters {
  serverId?: string;
  type?: string;
  severity?: string;
  sourceIp?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class SecurityService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Build a WHERE clause + params from filters. Always bounds the time range. */
  private where(f: SecFilters) {
    const to = f.to ? new Date(f.to) : new Date();
    const from = f.from ? new Date(f.from) : new Date(to.getTime() - 24 * 3600_000);
    const cond = ['se.time BETWEEN $1 AND $2'];
    const params: any[] = [from, to];
    if (f.serverId) { params.push(f.serverId); cond.push(`se.server_id = $${params.length}`); }
    if (f.type) { params.push(f.type); cond.push(`se.event_type = $${params.length}`); }
    if (f.severity) { params.push(f.severity); cond.push(`se.severity = $${params.length}`); }
    if (f.sourceIp) { params.push(`%${f.sourceIp}%`); cond.push(`se.source_ip::text ILIKE $${params.length}`); }
    return { clause: cond.join(' AND '), params, from, to };
  }

  /** Filtered, joined event list. */
  async events(f: SecFilters, limit = 300) {
    const { clause, params } = this.where(f);
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT se.id, se.time, se.event_type, se.severity, se.source_ip, se.username,
              se.message, se.server_id, s.name AS server_name
         FROM security_events se
         LEFT JOIN servers s ON s.id = se.server_id
        WHERE ${clause}
        ORDER BY se.time DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  /** Summary aggregations + severity timeseries. */
  async stats(f: SecFilters) {
    const { clause, params, from, to } = this.where(f);

    const total = await this.pool.query(
      `SELECT count(*)::int AS c FROM security_events se WHERE ${clause}`, params);

    const byType = await this.pool.query(
      `SELECT se.event_type, count(*)::int AS c FROM security_events se
        WHERE ${clause} GROUP BY se.event_type ORDER BY c DESC`, params);

    const bySeverity = await this.pool.query(
      `SELECT se.severity, count(*)::int AS c FROM security_events se
        WHERE ${clause} GROUP BY se.severity`, params);

    const byServer = await this.pool.query(
      `SELECT s.name AS server_name, se.server_id, count(*)::int AS c
         FROM security_events se LEFT JOIN servers s ON s.id = se.server_id
        WHERE ${clause} GROUP BY se.server_id, s.name ORDER BY c DESC`, params);

    const topIps = await this.pool.query(
      `SELECT se.source_ip::text AS source_ip, count(*)::int AS c
         FROM security_events se
        WHERE ${clause} AND se.source_ip IS NOT NULL
        GROUP BY se.source_ip ORDER BY c DESC LIMIT 10`, params);

    // Choose a bucket size from the range so charts stay readable.
    const spanMs = to.getTime() - from.getTime();
    const bucket =
      spanMs <= 6 * 3600_000 ? '5 minutes' :
      spanMs <= 24 * 3600_000 ? '1 hour' :
      spanMs <= 7 * 24 * 3600_000 ? '6 hours' : '1 day';
    const tsParams = [...params, bucket];
    const timeseries = await this.pool.query(
      `SELECT time_bucket($${tsParams.length}::interval, se.time) AS bucket,
              count(*)::int AS total,
              count(*) FILTER (WHERE se.severity='low')::int AS low,
              count(*) FILTER (WHERE se.severity='medium')::int AS medium,
              count(*) FILTER (WHERE se.severity='high')::int AS high,
              count(*) FILTER (WHERE se.severity='critical')::int AS critical
         FROM security_events se
        WHERE ${clause}
        GROUP BY bucket ORDER BY bucket`, tsParams);

    return {
      range: { from, to, bucket },
      total: total.rows[0].c,
      byType: byType.rows,
      bySeverity: bySeverity.rows,
      byServer: byServer.rows,
      topIps: topIps.rows,
      timeseries: timeseries.rows,
    };
  }

  /** Group identical activity to answer "how many times": type + ip + server. */
  async grouped(f: SecFilters, limit = 100) {
    const { clause, params } = this.where(f);
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT se.event_type, se.severity, se.source_ip::text AS source_ip,
              se.server_id, s.name AS server_name,
              count(*)::int AS occurrences,
              min(se.time) AS first_seen, max(se.time) AS last_seen,
              max(se.message) AS sample_message
         FROM security_events se LEFT JOIN servers s ON s.id = se.server_id
        WHERE ${clause}
        GROUP BY se.event_type, se.severity, se.source_ip, se.server_id, s.name
        ORDER BY occurrences DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  /** Distinct event types present (for the filter dropdown). */
  async types() {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT event_type FROM security_events ORDER BY event_type`);
    return rows.map((r) => r.event_type);
  }
}
