import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Injectable()
export class AlertsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(status?: string) {
    if (status) {
      return this.pool
        .query(
          `SELECT a.*, s.name AS server_name FROM alerts a
             LEFT JOIN servers s ON s.id = a.server_id
            WHERE a.status = $1 ORDER BY a.created_at DESC LIMIT 500`,
          [status],
        )
        .then((r) => r.rows);
    }
    return this.pool
      .query(
        `SELECT a.*, s.name AS server_name FROM alerts a
           LEFT JOIN servers s ON s.id = a.server_id
          ORDER BY a.created_at DESC LIMIT 500`,
      )
      .then((r) => r.rows);
  }

  async resolve(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE alerts SET status='resolved', resolved_at=now()
        WHERE id=$1 RETURNING *`,
      [id],
    );
    return rows[0];
  }
}
