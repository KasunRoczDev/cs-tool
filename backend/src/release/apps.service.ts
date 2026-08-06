import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface AppRow {
  id: string;
  name: string;
  description: string | null;
  product_id: string | null;
  product_name: string | null;
  repository_id: string | null;
  repository_name: string | null;
  created_at: string;
}

export interface AppServerRow {
  id: string;
  server_app_id: string;
  name: string;
  hostname: string | null;
  status: string;
  nginx_config: string | null;
  php_fpm_config: string | null;
  php_ini_config: string | null;
}

export interface AppInput {
  name: string;
  description?: string;
  product_id?: string;
  repository_id?: string;
}

const LIST_SELECT = `
  SELECT a.id, a.name, a.description, a.product_id, p.name AS product_name,
         a.repository_id, r.name AS repository_name, a.created_at
    FROM apps a
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN repositories r ON r.id = a.repository_id`;

@Injectable()
export class AppsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<AppRow[]> {
    const { rows } = await this.pool.query(`${LIST_SELECT} ORDER BY a.name`);
    return rows;
  }

  async get(id: string): Promise<AppRow> {
    const { rows } = await this.pool.query(`${LIST_SELECT} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('App not found');
    return rows[0];
  }

  async create(input: AppInput, userId: string): Promise<AppRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO apps (name, description, product_id, repository_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.name, input.description ?? null, input.product_id ?? null, input.repository_id ?? null, userId],
    );
    return this.get(rows[0].id);
  }

  async update(id: string, patch: Partial<AppInput>): Promise<AppRow> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.product_id !== undefined) push('product_id', patch.product_id);
    if (patch.repository_id !== undefined) push('repository_id', patch.repository_id);
    if (sets.length === 0) return this.get(id);
    params.push(id);
    const { rowCount } = await this.pool.query(
      `UPDATE apps SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (!rowCount) throw new NotFoundException('App not found');
    return this.get(id);
  }

  async remove(id: string): Promise<{ deleted: string }> {
    const { rowCount } = await this.pool.query('DELETE FROM apps WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('App not found');
    return { deleted: id };
  }

  /** Servers hosting this app, with their per-server config (reverse of ServerAppsService.list). */
  async listServers(appId: string): Promise<AppServerRow[]> {
    const { rows } = await this.pool.query(
      `SELECT sv.id, sa.id AS server_app_id, sv.name, sv.hostname, sv.status,
              sa.nginx_config, sa.php_fpm_config, sa.php_ini_config
         FROM server_apps sa
         JOIN servers sv ON sv.id = sa.server_id
        WHERE sa.app_id = $1
        ORDER BY sv.name`,
      [appId],
    );
    return rows;
  }
}
