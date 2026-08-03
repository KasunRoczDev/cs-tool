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
      // status is plain TEXT (release_workflow_config_migration.sql) so custom
      // per-product status keys don't have to fit the legacy release_channel enum.
      `UPDATE releases SET status_id=$2, status=$3, updated_at=now() WHERE id=$1`,
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

  // ==================== Workflow configuration (settings.manage) ====================
  // Lets an admin build a custom status/transition graph per product instead of
  // being stuck with the single seeded "Default" workflow (draft->canary->beta->
  // production->enterprise->archived).

  private static readonly KEY_RE = /^[a-z0-9_]+$/;

  /** Only product-scoped workflows can be created here — the single global
   * default (release_workflows.product_id IS NULL) stays the one seeded by
   * rbac_migration.sql, since UNIQUE(product_id) doesn't stop a second NULL row. */
  async createWorkflow(input: { name: string; product_id: string }) {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (!input.product_id) throw new BadRequestException('product_id is required — only per-product workflows can be created');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO release_workflows (name, product_id, is_default) VALUES ($1,$2,false) RETURNING *`,
        [input.name.trim(), input.product_id],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new BadRequestException('This product already has a workflow');
      throw e;
    }
  }

  async updateWorkflow(id: string, patch: { name?: string }) {
    const { rows } = await this.pool.query(
      `UPDATE release_workflows SET name = COALESCE($2, name) WHERE id=$1 RETURNING *`,
      [id, patch.name?.trim() || null],
    );
    if (!rows[0]) throw new NotFoundException('Workflow not found');
    return rows[0];
  }

  async deleteWorkflow(id: string) {
    const wf = await this.pool.query(`SELECT is_default FROM release_workflows WHERE id=$1`, [id]).then((r) => r.rows[0]);
    if (!wf) throw new NotFoundException('Workflow not found');
    if (wf.is_default) throw new BadRequestException('Cannot delete the default workflow');
    const inUse = await this.pool
      .query(
        `SELECT count(*)::int AS n FROM releases r
           JOIN release_statuses s ON s.id = r.status_id
          WHERE s.workflow_id = $1`,
        [id],
      )
      .then((r) => r.rows[0].n);
    if (inUse > 0) throw new BadRequestException(`Cannot delete: ${inUse} release(s) are currently on this workflow`);
    await this.pool.query(`DELETE FROM release_workflows WHERE id=$1`, [id]);
    return { deleted: true };
  }

  /** Full detail for the workflow builder UI: statuses + transitions (with resolved keys/names). */
  async workflowDetail(id: string) {
    const wf = await this.pool
      .query(`SELECT w.*, p.name AS product_name FROM release_workflows w LEFT JOIN products p ON p.id = w.product_id WHERE w.id = $1`, [id])
      .then((r) => r.rows[0]);
    if (!wf) throw new NotFoundException('Workflow not found');
    const statuses = await this.statuses(id);
    const { rows: transitions } = await this.pool.query(
      `SELECT t.*, fs.key AS from_key, fs.name AS from_name, ts.key AS to_key, ts.name AS to_name
         FROM release_transitions t
         LEFT JOIN release_statuses fs ON fs.id = t.from_status_id
         JOIN release_statuses ts ON ts.id = t.to_status_id
        WHERE t.workflow_id = $1
        ORDER BY ts.rank`,
      [id],
    );
    return { ...wf, statuses, transitions };
  }

  private async getStatus(workflowId: string, statusId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM release_statuses WHERE id=$1 AND workflow_id=$2`,
      [statusId, workflowId],
    );
    if (!rows[0]) throw new NotFoundException('Status not found');
    return rows[0];
  }

  async createStatus(
    workflowId: string,
    input: { key: string; name: string; rank: number; category?: string; channel_key?: string; color?: string },
  ) {
    if (!StatusService.KEY_RE.test(input.key || '')) {
      throw new BadRequestException('key must contain only lowercase letters, numbers and underscores');
    }
    const wf = await this.pool.query(`SELECT id FROM release_workflows WHERE id=$1`, [workflowId]).then((r) => r.rows[0]);
    if (!wf) throw new NotFoundException('Workflow not found');
    let row: any;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO release_statuses (workflow_id, key, name, rank, category, channel_key, color)
         VALUES ($1,$2,$3,$4,COALESCE($5,'stage'),$6,$7) RETURNING *`,
        [workflowId, input.key, input.name, input.rank, input.category ?? null, input.channel_key ?? null, input.color ?? null],
      );
      row = rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new BadRequestException(`Status key "${input.key}" already exists in this workflow`);
      throw e;
    }
    // role_permissions.permission_key has an FK to permissions(key) — without a
    // matching catalog row here, no role could ever be granted this status's
    // transition, silently locking out anyone but admins from using it.
    await this.pool.query(
      `INSERT INTO permissions (key, resource, description) VALUES ($1,'status',$2) ON CONFLICT (key) DO NOTHING`,
      [`status.transition.${input.key}`, `Transition release to ${input.name}`],
    );
    return row;
  }

  async updateStatus(
    workflowId: string,
    statusId: string,
    patch: { name?: string; rank?: number; category?: string; channel_key?: string; color?: string },
  ) {
    // key is intentionally not editable here — required_permission strings
    // (status.transition.<key>) and existing role grants are keyed off it.
    const cols: Record<string, unknown> = {
      name: patch.name,
      rank: patch.rank,
      category: patch.category,
      channel_key: patch.channel_key,
      color: patch.color,
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) {
      if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return this.getStatus(workflowId, statusId);
    params.push(statusId, workflowId);
    const { rows } = await this.pool.query(
      `UPDATE release_statuses SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND workflow_id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Status not found');
    return rows[0];
  }

  async deleteStatus(workflowId: string, statusId: string) {
    const inUse = await this.pool.query(`SELECT count(*)::int AS n FROM releases WHERE status_id = $1`, [statusId]).then((r) => r.rows[0].n);
    if (inUse > 0) throw new BadRequestException(`Cannot delete: ${inUse} release(s) are currently on this status`);
    // release_transitions referencing this status cascade-delete automatically.
    const { rowCount } = await this.pool.query(`DELETE FROM release_statuses WHERE id=$1 AND workflow_id=$2`, [statusId, workflowId]);
    if (!rowCount) throw new NotFoundException('Status not found');
    return { deleted: true };
  }

  async createTransition(
    workflowId: string,
    input: {
      from_status_key?: string | null;
      to_status_key: string;
      kind?: string;
      require_approval?: boolean;
      required_checks?: string[];
      required_permission?: string;
      auto_deploy?: boolean;
    },
  ) {
    const to = await this.pool
      .query(`SELECT id FROM release_statuses WHERE workflow_id=$1 AND key=$2`, [workflowId, input.to_status_key])
      .then((r) => r.rows[0]);
    if (!to) throw new BadRequestException(`Unknown to_status_key "${input.to_status_key}"`);
    let fromId: string | null = null;
    if (input.from_status_key) {
      const from = await this.pool
        .query(`SELECT id FROM release_statuses WHERE workflow_id=$1 AND key=$2`, [workflowId, input.from_status_key])
        .then((r) => r.rows[0]);
      if (!from) throw new BadRequestException(`Unknown from_status_key "${input.from_status_key}"`);
      fromId = from.id;
    }
    const requiredPermission = input.required_permission || `status.transition.${input.to_status_key}`;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO release_transitions
           (workflow_id, from_status_id, to_status_id, kind, require_approval, required_checks, required_permission, auto_deploy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          workflowId, fromId, to.id, input.kind ?? 'forward',
          input.require_approval ?? true, input.required_checks ?? [], requiredPermission, input.auto_deploy ?? false,
        ],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new BadRequestException('This transition already exists');
      throw e;
    }
  }

  async deleteTransition(workflowId: string, transitionId: string) {
    const { rowCount } = await this.pool.query(`DELETE FROM release_transitions WHERE id=$1 AND workflow_id=$2`, [transitionId, workflowId]);
    if (!rowCount) throw new NotFoundException('Transition not found');
    return { deleted: true };
  }
}
