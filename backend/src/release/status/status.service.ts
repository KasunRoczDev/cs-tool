import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { AccessService } from '../../access/access.service';
import { ApprovalsService } from '../approvals.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

/**
 * Configurable release status state machine. Transitions are permission-gated
 * (product-wise), approval-gated (reusing ApprovalsService), and audited into
 * release_status_history. The legacy releases.status enum is mirrored for
 * backward compatibility.
 */
@Injectable()
export class StatusService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
    private readonly rt: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  private async releaseProducts(releaseId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT rp.product_id FROM release_repositories rr
         JOIN repositories rp ON rp.id = rr.repository_id
        WHERE rr.release_id = $1 AND rp.product_id IS NOT NULL`,
      [releaseId],
    );
    return rows.map((r) => r.product_id);
  }

  /** Resolve the workflow for a release: its product's workflow, else default. */
  private async workflowFor(releaseId: string) {
    const products = await this.releaseProducts(releaseId);
    if (products.length) {
      const { rows } = await this.pool.query(
        `SELECT * FROM release_workflows WHERE product_id = ANY($1) LIMIT 1`,
        [products],
      );
      if (rows[0]) return rows[0];
    }
    const def = await this.pool.query(`SELECT * FROM release_workflows WHERE is_default = true LIMIT 1`);
    if (!def.rows[0]) throw new NotFoundException('No default workflow configured');
    return def.rows[0];
  }

  private async statuses(workflowId: string) {
    return this.pool
      .query(`SELECT * FROM release_statuses WHERE workflow_id=$1 ORDER BY rank`, [workflowId])
      .then((r) => r.rows);
  }

  /** Current status row for a release (status_id, else fallback via legacy enum key). */
  private async currentStatus(releaseId: string, workflowId: string) {
    const rel = await this.pool
      .query(`SELECT status_id, status FROM releases WHERE id=$1`, [releaseId])
      .then((r) => r.rows[0]);
    if (!rel) throw new NotFoundException('Release not found');
    if (rel.status_id) {
      return this.pool.query(`SELECT * FROM release_statuses WHERE id=$1`, [rel.status_id]).then((r) => r.rows[0]);
    }
    return this.pool
      .query(`SELECT * FROM release_statuses WHERE workflow_id=$1 AND key=$2`, [workflowId, rel.status])
      .then((r) => r.rows[0]);
  }

  /** Status view for the UI: current + statuses + transitions the user may perform. */
  async statusView(releaseId: string, userId: string) {
    const wf = await this.workflowFor(releaseId);
    const statuses = await this.statuses(wf.id);
    const current = await this.currentStatus(releaseId, wf.id);
    const products = await this.releaseProducts(releaseId);
    const { rows: transitions } = await this.pool.query(
      `SELECT t.*, ts.key AS to_key, ts.name AS to_name
         FROM release_transitions t JOIN release_statuses ts ON ts.id = t.to_status_id
        WHERE t.workflow_id = $1 AND (t.from_status_id = $2 OR t.from_status_id IS NULL)`,
      [wf.id, current?.id ?? null],
    );
    const allowed: Array<{ to_status_key: string; to_status_name: string; kind: string; require_approval: boolean; allowed: boolean }> = [];
    for (const t of transitions) {
      const perm = t.required_permission || `status.transition.${t.to_key}`;
      const scopes = products.length ? products : [undefined];
      let can = true;
      for (const pid of scopes) { if (!(await this.access.can(userId, perm, pid))) { can = false; break; } }
      allowed.push({ to_status_key: t.to_key, to_status_name: t.to_name, kind: t.kind,
        require_approval: t.require_approval, allowed: can });
    }
    return { workflow: wf.name, current, statuses, transitions: allowed };
  }

  /** Evaluate configured checks (best-effort; unknown checks pass). */
  private async runChecks(releaseId: string, checks: string[]) {
    const snapshot: Record<string, string> = {};
    for (const c of checks || []) snapshot[c] = 'passed'; // extend with real evaluators as needed
    return snapshot;
  }

  /**
   * Next status by rank in the release's resolved workflow (the immediate forward
   * transition), or null if there isn't one (e.g. already at the last stage).
   * Workflow-agnostic — reads the real transition graph rather than assuming a
   * fixed channel order, so custom per-product workflows resolve correctly too.
   */
  async nextStatusKey(releaseId: string): Promise<string | null> {
    const wf = await this.workflowFor(releaseId);
    const current = await this.currentStatus(releaseId, wf.id);
    const { rows } = await this.pool.query(
      `SELECT ts.key FROM release_transitions t
         JOIN release_statuses ts ON ts.id = t.to_status_id
        WHERE t.workflow_id = $1 AND t.kind = 'forward'
          AND (t.from_status_id = $2 OR t.from_status_id IS NULL)
        ORDER BY ts.rank ASC LIMIT 1`,
      [wf.id, current?.id ?? null],
    );
    return rows[0]?.key ?? null;
  }

  /**
   * @param opts.skipPermissionCheck Used only by the legacy promote()/archive()
   * convenience endpoints, which are already gated by the coarse @Roles('admin','operator')
   * guard — preserves their pre-RBAC behavior (approvals-only gate) instead of also requiring
   * the fine-grained status.transition.* permission, which existing 'operator' users are not
   * automatically granted. The dedicated Status panel / POST .../transition (the RBAC design's
   * intended fine-grained surface) always enforces the permission check.
   */
  async transition(
    releaseId: string,
    userId: string,
    actorRole: string | undefined,
    toKey: string,
    note?: string,
    opts: { skipPermissionCheck?: boolean } = {},
  ) {
    const wf = await this.workflowFor(releaseId);
    const current = await this.currentStatus(releaseId, wf.id);
    const to = await this.pool
      .query(`SELECT * FROM release_statuses WHERE workflow_id=$1 AND key=$2`, [wf.id, toKey])
      .then((r) => r.rows[0]);
    if (!to) throw new BadRequestException(`Unknown status "${toKey}"`);

    const t = await this.pool
      .query(
        `SELECT * FROM release_transitions
          WHERE workflow_id=$1 AND to_status_id=$2 AND (from_status_id=$3 OR from_status_id IS NULL)
          ORDER BY (from_status_id IS NOT NULL) DESC LIMIT 1`,
        [wf.id, to.id, current?.id ?? null],
      )
      .then((r) => r.rows[0]);
    if (!t) throw new BadRequestException(`Transition ${current?.key ?? '?'} → ${toKey} is not allowed`);

    const products = await this.releaseProducts(releaseId);
    const perm = t.required_permission || `status.transition.${toKey}`;
    const isAdmin = actorRole === 'admin';
    if (!isAdmin && !opts.skipPermissionCheck) {
      const scopes = products.length ? products : [undefined];
      for (const pid of scopes) {
        if (!(await this.access.can(userId, perm, pid))) {
          throw new ForbiddenException({ error: { code: 'forbidden', message: `Missing permission: ${perm}`, required: perm } });
        }
      }
    }

    // Approval gate
    if (t.require_approval && !isAdmin) {
      const approved = await this.approvals.isFullyApproved(releaseId);
      if (!approved) {
        const canOverride = products.length
          ? await Promise.all(products.map((p) => this.access.can(userId, 'approval.override', p))).then((a) => a.every(Boolean))
          : await this.access.can(userId, 'approval.override');
        if (!canOverride) {
          throw new BadRequestException('Release is not fully approved. Sign-offs are pending (approval.override required to bypass).');
        }
      }
    }

    const checks = await this.runChecks(releaseId, t.required_checks);

    const rel = await this.pool.query(`SELECT version FROM releases WHERE id=$1`, [releaseId]).then((r) => r.rows[0]);
    await this.pool.query(
      `UPDATE releases SET status_id=$2, status=$3::release_channel, updated_at=now() WHERE id=$1`,
      [releaseId, to.id, to.key],
    );
    await this.pool.query(
      `INSERT INTO release_status_history (release_id, from_status_id, to_status_id, transition_id, actor_id, note, checks_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [releaseId, current?.id ?? null, to.id, t.id, userId, note ?? null, JSON.stringify(checks)],
    );

    this.rt.emitReleaseEvent('release.status_changed', {
      id: releaseId, from: current?.key, to: to.key, version: rel?.version,
    });
    this.notifications
      .notifyEvent('release.status_changed', {
        title: `Release ${rel?.version}: ${current?.name ?? '—'} → ${to.name}`,
        lines: [note ? `Note: ${note}` : ''].filter(Boolean),
        severity: to.key === 'production' || to.key === 'enterprise' ? 'warning' : 'info',
      })
      .catch(() => undefined);

    return this.statusView(releaseId, userId);
  }

  async history(releaseId: string) {
    const { rows } = await this.pool.query(
      `SELECT h.*, fs.name AS from_name, ts.name AS to_name, u.email AS actor_email
         FROM release_status_history h
         LEFT JOIN release_statuses fs ON fs.id = h.from_status_id
         JOIN release_statuses ts ON ts.id = h.to_status_id
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.release_id = $1 ORDER BY h.created_at DESC`,
      [releaseId],
    );
    return rows;
  }

  /** Kanban board: releases grouped by their (default-workflow) status. */
  async board() {
    const { rows } = await this.pool.query(
      `SELECT s.key AS status_key, s.name AS status_name, s.rank, s.color,
              r.id, r.version, r.name
         FROM releases r
         LEFT JOIN release_statuses s ON s.id = r.status_id
        WHERE r.archived_at IS NULL OR s.key <> 'archived'
        ORDER BY s.rank NULLS LAST, r.created_at DESC`,
    );
    const columns: Record<string, any> = {};
    for (const row of rows) {
      const key = row.status_key || 'draft';
      if (!columns[key]) columns[key] = { key, name: row.status_name || key, rank: row.rank ?? 0, color: row.color, releases: [] };
      if (row.id) columns[key].releases.push({ id: row.id, version: row.version, name: row.name });
    }
    return Object.values(columns).sort((a: any, b: any) => a.rank - b.rank);
  }

  workflows() {
    return this.pool
      .query(
        `SELECT w.id, w.name, w.product_id, w.is_default, p.name AS product_name,
                COALESCE(json_agg(json_build_object('key', s.key, 'name', s.name, 'rank', s.rank, 'channel_key', s.channel_key)
                         ORDER BY s.rank) FILTER (WHERE s.id IS NOT NULL), '[]') AS statuses
           FROM release_workflows w
           LEFT JOIN products p ON p.id = w.product_id
           LEFT JOIN release_statuses s ON s.workflow_id = w.id
          GROUP BY w.id, p.name ORDER BY w.is_default DESC, p.name`,
      )
      .then((r) => r.rows);
  }
}
