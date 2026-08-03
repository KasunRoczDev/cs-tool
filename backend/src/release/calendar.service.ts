import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface CreateFreezeWindowInput {
  name: string;
  starts_at: string;
  ends_at: string;
  channel_id?: string;
  product_id?: string;
  reason?: string;
  created_by?: string;
}

/**
 * Release calendar: planned release dates + deployment history/schedule +
 * freeze windows, aggregated for the calendar view. Freeze windows also gate
 * DeploymentsService.deploy()/sweepScheduledDeployments() via activeFreeze().
 */
@Injectable()
export class CalendarService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  listFreezeWindows() {
    return this.pool
      .query(
        `SELECT fw.*, c.name AS channel_name, p.name AS product_name
           FROM deployment_freeze_windows fw
           LEFT JOIN channels c ON c.id = fw.channel_id
           LEFT JOIN products p ON p.id = fw.product_id
          ORDER BY fw.starts_at DESC`,
      )
      .then((r) => r.rows);
  }

  async createFreezeWindow(input: CreateFreezeWindowInput) {
    if (Number.isNaN(Date.parse(input.starts_at)) || Number.isNaN(Date.parse(input.ends_at))) {
      throw new BadRequestException('starts_at/ends_at must be valid dates');
    }
    if (new Date(input.ends_at) <= new Date(input.starts_at)) {
      throw new BadRequestException('ends_at must be after starts_at');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO deployment_freeze_windows (name, starts_at, ends_at, channel_id, product_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.name, input.starts_at, input.ends_at,
        input.channel_id || null, input.product_id || null,
        input.reason ?? null, input.created_by ?? null,
      ],
    );
    return rows[0];
  }

  async deleteFreezeWindow(id: string) {
    const { rowCount } = await this.pool.query(`DELETE FROM deployment_freeze_windows WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Freeze window not found');
    return { deleted: true };
  }

  /** The active freeze window (if any) covering `at` for this channel + any of these products. */
  async activeFreeze(channelId: string, productIds: string[], at: Date = new Date()) {
    const { rows } = await this.pool.query(
      `SELECT * FROM deployment_freeze_windows
        WHERE starts_at <= $1 AND ends_at >= $1
          AND (channel_id IS NULL OR channel_id = $2)
          AND (product_id IS NULL OR product_id = ANY($3::uuid[]))
        ORDER BY starts_at LIMIT 1`,
      [at, channelId, productIds],
    );
    return rows[0] ?? null;
  }

  /** Planned releases, deployments, and freeze windows overlapping [from, to]. */
  async calendar(from: string, to: string) {
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new BadRequestException('from/to must be valid dates');
    }
    const [releases, deployments, freezeWindows] = await Promise.all([
      this.pool.query(
        `SELECT id, version, name, status, planned_date FROM releases
          WHERE planned_date BETWEEN $1 AND $2
          ORDER BY planned_date`,
        [from, to],
      ),
      this.pool.query(
        `SELECT d.id, d.status, d.current_version, d.scheduled_at, d.finished_at, d.created_at,
                c.key AS channel_key, c.name AS channel_name, r.version AS release_version
           FROM deployments d
           JOIN channels c ON c.id = d.channel_id
           JOIN releases r ON r.id = d.release_id
          WHERE COALESCE(d.scheduled_at, d.finished_at, d.created_at) BETWEEN $1 AND $2
          ORDER BY COALESCE(d.scheduled_at, d.finished_at, d.created_at)`,
        [from, to],
      ),
      this.pool.query(
        `SELECT fw.*, c.name AS channel_name, p.name AS product_name
           FROM deployment_freeze_windows fw
           LEFT JOIN channels c ON c.id = fw.channel_id
           LEFT JOIN products p ON p.id = fw.product_id
          WHERE fw.starts_at <= $2 AND fw.ends_at >= $1
          ORDER BY fw.starts_at`,
        [from, to],
      ),
    ]);
    return { releases: releases.rows, deployments: deployments.rows, freeze_windows: freezeWindows.rows };
  }
}
