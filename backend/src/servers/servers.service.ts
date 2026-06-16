import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { generateApiKey, hashApiKey } from '../common/hash.util';

@Injectable()
export class ServersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Onboard a server; returns the plaintext API key ONCE. */
  async register(name: string, hostname?: string, ip?: string, os?: string) {
    const apiKey = generateApiKey();
    const { rows } = await this.pool.query(
      `INSERT INTO servers (name, hostname, ip_address, os, api_key_hash)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, hostname, status, created_at`,
      [name, hostname ?? null, ip ?? null, os ?? null, hashApiKey(apiKey)],
    );
    return { ...rows[0], api_key: apiKey };
  }

  list() {
    return this.pool
      .query(
        `SELECT id, name, hostname, ip_address, os, status, last_seen, tags, created_at
           FROM servers ORDER BY name`,
      )
      .then((r) => r.rows);
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT id, name, hostname, ip_address, os, status, last_seen, tags, created_at
         FROM servers WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Server not found');
    return rows[0];
  }

  async remove(id: string) {
    await this.pool.query('DELETE FROM servers WHERE id = $1', [id]);
    return { deleted: id };
  }

  /**
   * Time-series metrics for charts. Uses the 1-minute continuous aggregate for
   * ranges > 6h, raw data otherwise.
   */
  async metrics(id: string, fromIso?: string, toIso?: string) {
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso ? new Date(fromIso) : new Date(to.getTime() - 3600_000);
    const useRollup = to.getTime() - from.getTime() > 6 * 3600_000;
    if (useRollup) {
      const { rows } = await this.pool.query(
        `SELECT bucket AS time, cpu_usage, memory_usage, disk_usage, net_in, net_out
           FROM metrics_1m
          WHERE server_id=$1 AND bucket BETWEEN $2 AND $3
          ORDER BY bucket`,
        [id, from, to],
      );
      return rows;
    }
    const { rows } = await this.pool.query(
      `SELECT time, cpu_usage, memory_usage, disk_usage, net_in, net_out
         FROM metrics
        WHERE server_id=$1 AND time BETWEEN $2 AND $3
        ORDER BY time`,
      [id, from, to],
    );
    return rows;
  }

  securityEvents(id: string, type?: string, limit = 200) {
    if (type) {
      return this.pool
        .query(
          `SELECT * FROM security_events
            WHERE server_id=$1 AND event_type=$2
            ORDER BY time DESC LIMIT $3`,
          [id, type, limit],
        )
        .then((r) => r.rows);
    }
    return this.pool
      .query(
        `SELECT * FROM security_events
          WHERE server_id=$1 ORDER BY time DESC LIMIT $2`,
        [id, limit],
      )
      .then((r) => r.rows);
  }

  /** Latest metric sample per server for the overview grid. */
  overview() {
    return this.pool
      .query(
        `SELECT s.id, s.name, s.status, s.last_seen,
                m.cpu_usage, m.memory_usage, m.disk_usage, m.time AS metric_time
           FROM servers s
           LEFT JOIN LATERAL (
             SELECT cpu_usage, memory_usage, disk_usage, time
               FROM metrics WHERE server_id = s.id
              ORDER BY time DESC LIMIT 1
           ) m ON true
          ORDER BY s.name`,
      )
      .then((r) => r.rows);
  }
}
