import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from'] as const;
type SmtpKey = typeof SMTP_KEYS[number];

export interface SmtpConfig {
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}

@Injectable()
export class SettingsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Return all settings as a flat key→value map. Passwords are masked. */
  async getAll(): Promise<Record<string, string>> {
    const { rows } = await this.pool.query('SELECT key, value FROM platform_settings ORDER BY key');
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.key === 'smtp_pass' && r.value ? '••••••••' : (r.value ?? '');
    }
    return out;
  }

  /** Return raw SMTP config (plaintext, for internal use by EmailService). */
  async getSmtpConfig(): Promise<SmtpConfig> {
    const { rows } = await this.pool.query(
      "SELECT key, value FROM platform_settings WHERE key = ANY($1::text[])",
      [SMTP_KEYS],
    );
    // Fall back to env vars if DB row is empty (allows env-var bootstrapping).
    const db: Record<string, string> = {};
    for (const r of rows) db[r.key] = r.value ?? '';

    return {
      smtp_host:   db.smtp_host   || process.env.SMTP_HOST   || '',
      smtp_port:   db.smtp_port   || process.env.SMTP_PORT   || '587',
      smtp_secure: db.smtp_secure || process.env.SMTP_SECURE || 'false',
      smtp_user:   db.smtp_user   || process.env.SMTP_USER   || '',
      smtp_pass:   db.smtp_pass   || process.env.SMTP_PASS   || '',
      smtp_from:   db.smtp_from   || process.env.SMTP_FROM   || '',
    };
  }

  /**
   * Upsert a batch of settings.
   * - If a password field is '••••••••' (masked), skip it (don't overwrite).
   */
  async setMany(patch: Record<string, string>, userId: string): Promise<Record<string, string>> {
    for (const [key, value] of Object.entries(patch)) {
      // Skip masked password placeholder
      if (key === 'smtp_pass' && value === '••••••••') continue;
      await this.pool.query(
        `INSERT INTO platform_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()`,
        [key, value, userId],
      );
    }
    return this.getAll();
  }
}
