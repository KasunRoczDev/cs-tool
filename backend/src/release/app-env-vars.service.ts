import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { encryptSecret } from '../common/crypto.util';

export interface UpsertAppEnvVarInput {
  key: string;
  value: string;
  is_secret?: boolean;
  channel_id?: string;
}

@Injectable()
export class AppEnvVarsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Masked list for the UI: secret values never leave the server. */
  async listEnvVars(appId: string, channelId?: string) {
    const where: string[] = ['aev.app_id = $1'];
    const params: any[] = [appId];
    if (channelId === 'none') {
      where.push('aev.channel_id IS NULL');
    } else if (channelId) {
      params.push(channelId);
      where.push(`aev.channel_id = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT aev.id, aev.app_id, aev.channel_id, aev.key, aev.is_secret,
              aev.value_plain, (aev.value_enc IS NOT NULL) AS has_value,
              c.name AS channel_name, aev.updated_at
         FROM app_env_vars aev
         LEFT JOIN channels c ON c.id = aev.channel_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.name NULLS FIRST, aev.key`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      app_id: r.app_id,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      key: r.key,
      is_secret: r.is_secret,
      value: r.is_secret ? null : r.value_plain,
      has_value: r.is_secret ? r.has_value : true,
      updated_at: r.updated_at,
    }));
  }

  async upsertEnvVar(appId: string, input: UpsertAppEnvVarInput) {
    const key = input.key?.trim();
    if (!key) throw new BadRequestException('key is required');
    if (input.value === undefined || input.value === null || input.value === '') {
      throw new BadRequestException('value is required');
    }
    const isSecret = !!input.is_secret;
    const channelId = input.channel_id || null;

    // Postgres UNIQUE(app_id, channel_id, key) doesn't catch duplicate NULL
    // channel_id rows (NULLs are distinct to it) — check explicitly.
    const existing = await this.pool.query(
      `SELECT id FROM app_env_vars
        WHERE app_id = $1 AND channel_id IS NOT DISTINCT FROM $2 AND key = $3`,
      [appId, channelId, key],
    );

    const valueEnc = isSecret ? encryptSecret(input.value) : null;
    const valuePlain = isSecret ? null : input.value;

    if (existing.rows[0]) {
      const { rows } = await this.pool.query(
        `UPDATE app_env_vars
            SET value_enc = $2, value_plain = $3, is_secret = $4, updated_at = now()
          WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, valueEnc, valuePlain, isSecret],
      );
      return rows[0];
    }
    const { rows } = await this.pool.query(
      `INSERT INTO app_env_vars (app_id, channel_id, key, value_enc, value_plain, is_secret)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [appId, channelId, key, valueEnc, valuePlain, isSecret],
    );
    return rows[0];
  }

  async deleteEnvVar(appId: string, id: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM app_env_vars WHERE id = $1 AND app_id = $2`,
      [id, appId],
    );
    if (!rowCount) throw new NotFoundException('Env var not found');
    return { deleted: true };
  }
}
