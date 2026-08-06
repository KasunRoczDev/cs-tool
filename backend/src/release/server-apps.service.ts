import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ServerAppRow {
  id: string;
  app_id: string;
  app_name: string;
  app_description: string | null;
  nginx_config: string | null;
  php_fpm_config: string | null;
  php_ini_config: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerAppInput {
  app_id: string;
  nginx_config?: string;
  php_fpm_config?: string;
  php_ini_config?: string;
}

const SELECT = `
  SELECT sa.id, sa.app_id, a.name AS app_name, a.description AS app_description,
         sa.nginx_config, sa.php_fpm_config, sa.php_ini_config, sa.created_at, sa.updated_at
    FROM server_apps sa
    JOIN apps a ON a.id = sa.app_id`;

@Injectable()
export class ServerAppsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(serverId: string): Promise<ServerAppRow[]> {
    const { rows } = await this.pool.query(
      `${SELECT} WHERE sa.server_id = $1 ORDER BY a.name`, [serverId]);
    return rows;
  }

  private async getOne(id: string): Promise<ServerAppRow> {
    const { rows } = await this.pool.query(`${SELECT} WHERE sa.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Server app link not found');
    return rows[0];
  }

  async link(serverId: string, input: ServerAppInput): Promise<ServerAppRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO server_apps (server_id, app_id, nginx_config, php_fpm_config, php_ini_config)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [serverId, input.app_id, input.nginx_config ?? null, input.php_fpm_config ?? null, input.php_ini_config ?? null],
    );
    return this.getOne(rows[0].id);
  }

  async updateConfig(
    serverId: string,
    appId: string,
    patch: Partial<Omit<ServerAppInput, 'app_id'>>,
  ): Promise<ServerAppRow> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.nginx_config !== undefined) push('nginx_config', patch.nginx_config);
    if (patch.php_fpm_config !== undefined) push('php_fpm_config', patch.php_fpm_config);
    if (patch.php_ini_config !== undefined) push('php_ini_config', patch.php_ini_config);
    sets.push('updated_at = now()');
    params.push(serverId, appId);
    const { rows } = await this.pool.query(
      `UPDATE server_apps SET ${sets.join(', ')}
        WHERE server_id = $${params.length - 1} AND app_id = $${params.length}
        RETURNING id`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Server app link not found');
    return this.getOne(rows[0].id);
  }

  async unlink(serverId: string, appId: string): Promise<{ deleted: true }> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM server_apps WHERE server_id = $1 AND app_id = $2', [serverId, appId]);
    if (!rowCount) throw new NotFoundException('Server app link not found');
    return { deleted: true };
  }
}
