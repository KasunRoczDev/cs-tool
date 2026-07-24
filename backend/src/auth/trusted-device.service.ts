import { Injectable, Inject } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const TRUST_DAYS = 7;

export interface TrustedDeviceRow {
  id: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  is_current: boolean;
}

@Injectable()
export class TrustedDeviceService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** sha256 hex of a raw device token. Only this hash is ever persisted. */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Human-readable label parsed from a User-Agent header, e.g. "Chrome on Windows". */
  labelFromUserAgent(ua?: string): string {
    if (!ua) return 'Unknown device';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os =
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad/.test(ua) ? 'iOS' :
      /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    return `${browser} on ${os}`;
  }

  /** Mint a new trusted-device token, store its hash, and return the RAW token
   *  (handed to the caller exactly once, for the cookie) plus its fixed 7-day expiry. */
  async issue(userId: string, ua: string | undefined, ip: string | undefined) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO trusted_devices (user_id, token_hash, label, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, this.hash(token), this.labelFromUserAgent(ua), ip ?? null, expiresAt],
    );
    return { token, expiresAt };
  }

  /** True if rawToken matches an active (unrevoked, unexpired) device for this user.
   *  Bumps last_used_at on a hit. A missing/expired/revoked/unknown token is just `false`. */
  async verify(userId: string, rawToken: string | undefined): Promise<boolean> {
    if (!rawToken) return false;
    const { rows } = await this.pool.query(
      `UPDATE trusted_devices SET last_used_at = now()
       WHERE user_id = $1 AND token_hash = $2
         AND revoked_at IS NULL AND expires_at > now()
       RETURNING id`,
      [userId, this.hash(rawToken)],
    );
    return rows.length > 0;
  }

  /** currentTokenHash (from the caller's own cookie, or null) flags which row is "this device". */
  async list(userId: string, currentTokenHash: string | null): Promise<TrustedDeviceRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, label, created_at, last_used_at, expires_at,
              (token_hash = $2) AS is_current
       FROM trusted_devices
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC`,
      [userId, currentTokenHash],
    );
    return rows;
  }

  /** Revoke one device. wasCurrent tells the caller whether to also clear the cookie. */
  async revoke(
    userId: string,
    id: string,
    currentTokenHash: string | null,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const { rows } = await this.pool.query(
      `UPDATE trusted_devices SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING (token_hash = $3) AS was_current`,
      [id, userId, currentTokenHash],
    );
    if (rows.length === 0) return { revoked: false, wasCurrent: false };
    return { revoked: true, wasCurrent: rows[0].was_current === true };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
