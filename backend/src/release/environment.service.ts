import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { encryptSecret, decryptSecret } from '../common/crypto.util';

export interface UpsertEnvVarInput {
  key: string;
  value: string;
  is_secret?: boolean;
  product_id?: string;
}

/**
 * Channel-scoped environment variables/secrets (+ optional product override)
 * and channel locking. Secrets are encrypted at rest and never returned in
 * plaintext by list/compare — only resolveForDeploy (called server-side when
 * building a deploy job's payload for the agent) decrypts them.
 */
@Injectable()
export class EnvironmentService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Masked list for the UI: secret values never leave the server. */
  async listEnvVars(channelId: string) {
    const { rows } = await this.pool.query(
      `SELECT cev.id, cev.channel_id, cev.product_id, cev.key, cev.is_secret,
              cev.value_plain, (cev.value_enc IS NOT NULL) AS has_value,
              p.name AS product_name, cev.updated_at
         FROM channel_env_vars cev
         LEFT JOIN products p ON p.id = cev.product_id
        WHERE cev.channel_id = $1
        ORDER BY p.name NULLS FIRST, cev.key`,
      [channelId],
    );
    return rows.map((r) => ({
      id: r.id,
      channel_id: r.channel_id,
      product_id: r.product_id,
      product_name: r.product_name,
      key: r.key,
      is_secret: r.is_secret,
      value: r.is_secret ? null : r.value_plain, // secrets: masked, never returned
      has_value: r.is_secret ? r.has_value : true,
      updated_at: r.updated_at,
    }));
  }

  async upsertEnvVar(channelId: string, input: UpsertEnvVarInput) {
    const key = input.key?.trim();
    if (!key) throw new BadRequestException('key is required');
    if (input.value === undefined || input.value === null || input.value === '') {
      throw new BadRequestException('value is required');
    }
    const isSecret = !!input.is_secret;
    const productId = input.product_id || null;

    // Postgres UNIQUE(channel_id, product_id, key) doesn't catch duplicate
    // NULL product_id rows (NULLs are distinct to it) — check explicitly.
    const existing = await this.pool.query(
      `SELECT id FROM channel_env_vars
        WHERE channel_id = $1 AND product_id IS NOT DISTINCT FROM $2 AND key = $3`,
      [channelId, productId, key],
    );

    const valueEnc = isSecret ? encryptSecret(input.value) : null;
    const valuePlain = isSecret ? null : input.value;

    if (existing.rows[0]) {
      const { rows } = await this.pool.query(
        `UPDATE channel_env_vars
            SET value_enc = $2, value_plain = $3, is_secret = $4, updated_at = now()
          WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, valueEnc, valuePlain, isSecret],
      );
      return rows[0];
    }
    const { rows } = await this.pool.query(
      `INSERT INTO channel_env_vars (channel_id, product_id, key, value_enc, value_plain, is_secret)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [channelId, productId, key, valueEnc, valuePlain, isSecret],
    );
    return rows[0];
  }

  async deleteEnvVar(channelId: string, id: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM channel_env_vars WHERE id = $1 AND channel_id = $2`,
      [id, channelId],
    );
    if (!rowCount) throw new NotFoundException('Env var not found');
    return { deleted: true };
  }

  /** Diff two channels' env vars by key. Secret values are compared (decrypted, server-side) but never returned. */
  async compareChannels(channelIdA: string, channelIdB: string) {
    const [a, b] = await Promise.all([
      this.pool.query(`SELECT * FROM channel_env_vars WHERE channel_id = $1`, [channelIdA]),
      this.pool.query(`SELECT * FROM channel_env_vars WHERE channel_id = $1`, [channelIdB]),
    ]);
    const keyOf = (r: any) => `${r.product_id ?? 'global'}:${r.key}`;
    const mapA = new Map(a.rows.map((r: any) => [keyOf(r), r]));
    const mapB = new Map(b.rows.map((r: any) => [keyOf(r), r]));
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    const reveal = (r: any) => (r ? (r.is_secret ? decryptSecret(r.value_enc) : r.value_plain) : undefined);

    const diff = [...allKeys].sort().map((k) => {
      const ra = mapA.get(k);
      const rb = mapB.get(k);
      return {
        scope: k,
        key: (ra ?? rb).key,
        product_id: (ra ?? rb).product_id,
        in_a: !!ra,
        in_b: !!rb,
        is_secret: !!(ra?.is_secret || rb?.is_secret),
        equal: ra && rb ? reveal(ra) === reveal(rb) : null,
      };
    });
    return diff;
  }

  /**
   * Decrypted `["KEY=VALUE", ...]` for a deploy job — product-specific vars
   * override same-key global (product_id NULL) ones. Called server-side only
   * when building a deploy_jobs row; never exposed via any read endpoint.
   */
  async resolveForDeploy(channelId: string, productId?: string | null): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT key, value_enc, value_plain, is_secret, product_id
         FROM channel_env_vars
        WHERE channel_id = $1 AND (product_id IS NULL OR product_id = $2)`,
      [channelId, productId ?? null],
    );
    const resolved = new Map<string, string>();
    // Global first, then product-specific so it overrides on key collision.
    for (const r of rows.filter((r) => !r.product_id)) {
      resolved.set(r.key, r.is_secret ? decryptSecret(r.value_enc) : r.value_plain);
    }
    for (const r of rows.filter((r) => r.product_id)) {
      resolved.set(r.key, r.is_secret ? decryptSecret(r.value_enc) : r.value_plain);
    }
    return [...resolved.entries()].map(([k, v]) => `${k}=${v}`);
  }

  async lockChannel(channelId: string, reason: string | undefined, userId?: string) {
    const { rows } = await this.pool.query(
      `UPDATE channels SET locked = true, locked_reason = $2, locked_by = $3, locked_at = now()
        WHERE id = $1 RETURNING *`,
      [channelId, reason ?? null, userId ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Channel not found');
    return rows[0];
  }

  async unlockChannel(channelId: string) {
    const { rows } = await this.pool.query(
      `UPDATE channels SET locked = false, locked_reason = NULL, locked_by = NULL, locked_at = NULL
        WHERE id = $1 RETURNING *`,
      [channelId],
    );
    if (!rows[0]) throw new NotFoundException('Channel not found');
    return rows[0];
  }
}
