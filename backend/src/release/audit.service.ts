import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface AuditFilters {
  release_id?: string;
  actor_id?: string;
  type?: string; // release_status | deployment | approval | account
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Unified, read-only audit feed over the release-management audit trails
 * that already exist as separate tables (release_status_history,
 * deployment_history, release_approval_history) plus the platform-wide
 * account audit_log — normalized into one queryable/exportable timeline.
 * No new write path: every row here was already being recorded by the
 * feature it belongs to; this just makes it visible and filterable.
 *
 * "Compliance reporting" here means evidence export (CSV) of exactly this
 * data — mapping it to a specific framework (SOX/ISO 27001/PCI DSS/HIPAA)
 * is a controls exercise for your compliance team, not something an app can
 * assert on your behalf.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(filters: AuditFilters) {
    const limit = Math.min(filters.limit ?? 200, 5000);
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT h.id, 'release_status' AS type, h.release_id, NULL::uuid AS deployment_id,
                h.actor_id, u.email AS actor_email, h.created_at AS at,
                r.version AS subject, (COALESCE(fs.name, '—') || ' → ' || ts.name) AS summary, h.note
           FROM release_status_history h
           JOIN releases r ON r.id = h.release_id
           LEFT JOIN release_statuses fs ON fs.id = h.from_status_id
           JOIN release_statuses ts ON ts.id = h.to_status_id
           LEFT JOIN users u ON u.id = h.actor_id

         UNION ALL

         SELECT h.id, 'deployment' AS type, d.release_id, h.deployment_id,
                h.actor_id, u.email AS actor_email, h.occurred_at AS at,
                r.version AS subject, (COALESCE(h.from_status, '—') || ' → ' || h.to_status) AS summary, h.note
           FROM deployment_history h
           JOIN deployments d ON d.id = h.deployment_id
           JOIN releases r ON r.id = d.release_id
           LEFT JOIN users u ON u.id = h.actor_id

         UNION ALL

         SELECT h.id, 'approval' AS type, h.release_id, NULL::uuid AS deployment_id,
                h.actor_id, act.email AS actor_email, h.occurred_at AS at,
                r.version AS subject, (h.approval_role || ': ' || h.decision) AS summary, h.note
           FROM release_approval_history h
           JOIN releases r ON r.id = h.release_id
           LEFT JOIN users act ON act.id = h.actor_id

         UNION ALL

         SELECT a.id, 'account' AS type, NULL::uuid AS release_id, NULL::uuid AS deployment_id,
                a.user_id AS actor_id, u.email AS actor_email, a.created_at AS at,
                a.target AS subject, a.action AS summary, NULL::text AS note
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
       ) x
       WHERE ($1::uuid IS NULL OR x.release_id = $1)
         AND ($2::uuid IS NULL OR x.actor_id = $2)
         AND ($3::text IS NULL OR x.type = $3)
         AND ($4::timestamptz IS NULL OR x.at >= $4)
         AND ($5::timestamptz IS NULL OR x.at <= $5)
       ORDER BY x.at DESC
       LIMIT $6`,
      [
        filters.release_id ?? null, filters.actor_id ?? null, filters.type ?? null,
        filters.from ?? null, filters.to ?? null, limit,
      ],
    );
    return rows;
  }

  /** Evidence export — same rows as list(), serialized as CSV. */
  toCsv(rows: any[]): string {
    const cols = ['at', 'type', 'subject', 'summary', 'actor_email', 'note', 'release_id', 'deployment_id'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
    return lines.join('\n');
  }
}
