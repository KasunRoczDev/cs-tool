import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

const ROLE_LABEL: Record<string, string> = {
  qa: 'QA', ba: 'BA', dev_lead: 'DEV Lead', tech_lead: 'Tech Lead',
};

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  private threadId(releaseId: string) {
    return `<release-approvals-${releaseId}@helm.local>`;
  }

  /** Users who must approve this release: approval-role holders on its product(s). */
  async requiredApprovers(releaseId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.approval_role, u.product_id, p.name AS product_name
         FROM users u
         LEFT JOIN products p ON p.id = u.product_id
        WHERE u.approval_role IS NOT NULL
          AND u.product_id IN (
            SELECT DISTINCT rp.product_id
              FROM release_repositories rr
              JOIN repositories rp ON rp.id = rr.repository_id
             WHERE rr.release_id = $1 AND rp.product_id IS NOT NULL
          )
        ORDER BY u.approval_role, u.email`,
      [releaseId],
    );
    return rows;
  }

  /** Full approval status: each required approver + their decision; gate flag. */
  async status(releaseId: string) {
    const release = await this.pool
      .query(`SELECT id, version FROM releases WHERE id = $1`, [releaseId])
      .then((r) => r.rows[0]);
    if (!release) throw new NotFoundException('Release not found');

    const required = await this.requiredApprovers(releaseId);
    const { rows: decisions } = await this.pool.query(
      `SELECT a.id, a.approver_id, a.approval_role, a.decision, a.remark, a.updated_at,
              a.expires_at, a.decided_on_behalf_of, u.email AS approver_email,
              ob.email AS decided_on_behalf_of_email,
              COALESCE(json_agg(json_build_object('id', att.id, 'filename', att.filename)
                       ORDER BY att.created_at) FILTER (WHERE att.id IS NOT NULL), '[]') AS attachments
         FROM release_approvals a
         JOIN users u ON u.id = a.approver_id
         LEFT JOIN users ob ON ob.id = a.decided_on_behalf_of
         LEFT JOIN release_approval_attachments att ON att.approval_id = a.id
        WHERE a.release_id = $1
        GROUP BY a.id, u.email, ob.email`,
      [releaseId],
    );
    const byApprover = new Map(decisions.map((d) => [d.approver_id, d]));

    const approvers = required.map((r) => {
      const d = byApprover.get(r.id);
      return {
        approver_id: r.id,
        email: r.email,
        role: r.approval_role,
        role_label: ROLE_LABEL[r.approval_role] || r.approval_role,
        product_name: r.product_name,
        decision: d?.decision ?? 'pending',
        remark: d?.remark ?? null,
        attachments: d?.attachments ?? [],
        decided_at: d?.updated_at ?? null,
        expires_at: d?.expires_at ?? null,
        decided_by: d?.decided_on_behalf_of_email ?? null, // set only when a delegate submitted for them
      };
    });

    const anyRejected = approvers.some((a) => a.decision === 'rejected');
    const allApproved = approvers.length > 0 && approvers.every((a) => a.decision === 'approved');
    // No designated approvers (e.g. product not yet configured) => not gated.
    const fullyApproved = approvers.length === 0 ? true : allApproved;

    return {
      release_id: releaseId,
      release_version: release.version,
      required_count: approvers.length,
      approved_count: approvers.filter((a) => a.decision === 'approved').length,
      pending: approvers.filter((a) => a.decision === 'pending').map((a) => a.email),
      rejected: anyRejected,
      fully_approved: fullyApproved,
      approvers,
    };
  }

  /** Hard-gate helper used by promote/deploy. */
  async isFullyApproved(releaseId: string) {
    return (await this.status(releaseId)).fully_approved;
  }

  /**
   * Submit (or update) a decision, with optional remark + file. `userId` must
   * be a required approver directly, OR hold an active delegation FROM one
   * (see createDelegation) — in which case the decision is recorded under the
   * delegator's slot with `decided_on_behalf_of` set to the actual submitter.
   */
  async submit(
    releaseId: string,
    userId: string,
    body: { decision?: string; remark?: string },
    file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
    const me = await this.pool
      .query(`SELECT id, email, approval_role, product_id FROM users WHERE id = $1`, [userId])
      .then((r) => r.rows[0]);
    if (!me) throw new NotFoundException('User not found');

    const required = await this.requiredApprovers(releaseId);
    let actingAs = required.find((r) => r.id === userId);
    let onBehalfOf: string | null = null;

    if (!actingAs && required.length > 0) {
      const delegation = await this.pool.query(
        `SELECT from_user FROM approval_delegations
          WHERE to_user = $1 AND from_user = ANY($2::uuid[]) AND revoked_at IS NULL
            AND now() BETWEEN starts_at AND ends_at
          LIMIT 1`,
        [userId, required.map((r) => r.id)],
      );
      if (delegation.rows[0]) {
        actingAs = required.find((r) => r.id === delegation.rows[0].from_user);
        onBehalfOf = userId;
      }
    }
    if (!actingAs) {
      throw new ForbiddenException('You are not a required approver for this release (check your product assignment or delegation)');
    }

    const expiryDays = Number(process.env.APPROVAL_EXPIRY_DAYS) || 0;
    const expiresAt = decision === 'approved' && expiryDays > 0
      ? new Date(Date.now() + expiryDays * 86_400_000)
      : null;

    const approval = await this.pool
      .query(
        `INSERT INTO release_approvals (release_id, approver_id, approval_role, decision, remark, expires_at, decided_on_behalf_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (release_id, approver_id)
         DO UPDATE SET decision = EXCLUDED.decision, remark = EXCLUDED.remark,
                       expires_at = EXCLUDED.expires_at, decided_on_behalf_of = EXCLUDED.decided_on_behalf_of,
                       updated_at = now()
         RETURNING id`,
        [releaseId, actingAs.id, actingAs.approval_role, decision, body.remark ?? null, expiresAt, onBehalfOf],
      )
      .then((r) => r.rows[0]);

    if (file && file.buffer) {
      await this.pool.query(
        `INSERT INTO release_approval_attachments (approval_id, filename, content_type, size, data)
         VALUES ($1,$2,$3,$4,$5)`,
        [approval.id, file.originalname, file.mimetype, file.size, file.buffer],
      );
    }

    await this.pool.query(
      `INSERT INTO release_approval_history (release_id, approver_id, approval_role, decision, remark, actor_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        releaseId, actingAs.id, actingAs.approval_role, decision, body.remark ?? null, userId,
        onBehalfOf ? `submitted by delegate ${me.email}` : null,
      ],
    );
    // They (or their delegate) just acted — no need to keep reminding.
    await this.pool.query(
      `DELETE FROM approval_reminders WHERE release_id = $1 AND approver_id = $2`,
      [releaseId, actingAs.id],
    );

    const status = await this.status(releaseId);
    await this.notifyApproval(status, { email: me.email, approval_role: actingAs.approval_role }, decision, body.remark);
    return status;
  }

  /** Only the delegator themself or an admin may create/revoke a delegation. */
  async createDelegation(
    fromUserId: string,
    toUserId: string,
    endsAt: string,
    reason: string | undefined,
    actorId: string,
    actorRole?: string,
  ) {
    if (actorId !== fromUserId && actorRole !== 'admin') {
      throw new ForbiddenException('Only the approver themself or an admin can create this delegation');
    }
    if (fromUserId === toUserId) throw new BadRequestException('Cannot delegate to yourself');
    const end = new Date(endsAt);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
      throw new BadRequestException('ends_at must be a valid date in the future');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO approval_delegations (from_user, to_user, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [fromUserId, toUserId, end, reason ?? null],
    );
    return rows[0];
  }

  /** Active delegations, optionally filtered to ones involving a given user (either side). */
  async listDelegations(userId?: string) {
    const { rows } = await this.pool.query(
      `SELECT d.*, uf.email AS from_email, ut.email AS to_email
         FROM approval_delegations d
         JOIN users uf ON uf.id = d.from_user
         JOIN users ut ON ut.id = d.to_user
        WHERE d.revoked_at IS NULL AND d.ends_at > now()
          AND ($1::uuid IS NULL OR d.from_user = $1 OR d.to_user = $1)
        ORDER BY d.starts_at DESC`,
      [userId ?? null],
    );
    return rows;
  }

  async revokeDelegation(id: string, actorId: string, actorRole?: string) {
    const d = await this.pool
      .query(`SELECT from_user FROM approval_delegations WHERE id = $1`, [id])
      .then((r) => r.rows[0]);
    if (!d) throw new NotFoundException('Delegation not found');
    if (d.from_user !== actorId && actorRole !== 'admin') {
      throw new ForbiddenException('Only the delegator or an admin can revoke this delegation');
    }
    await this.pool.query(`UPDATE approval_delegations SET revoked_at = now() WHERE id = $1`, [id]);
    return { revoked: true };
  }

  /** Admin/release-manager action: reset one approver's decision to pending and notify them. */
  async reRequestApproval(releaseId: string, approverId: string, actorId: string) {
    const approver = await this.pool
      .query(`SELECT email, approval_role FROM users WHERE id = $1`, [approverId])
      .then((r) => r.rows[0]);
    if (!approver) throw new NotFoundException('Approver not found');
    const release = await this.pool
      .query(`SELECT version FROM releases WHERE id = $1`, [releaseId])
      .then((r) => r.rows[0]);
    if (!release) throw new NotFoundException('Release not found');

    await this.pool.query(
      `DELETE FROM release_approvals WHERE release_id = $1 AND approver_id = $2`,
      [releaseId, approverId],
    );
    await this.pool.query(
      `INSERT INTO release_approval_history (release_id, approver_id, approval_role, decision, actor_id, note)
       VALUES ($1,$2,$3,'pending',$4,'re-requested')`,
      [releaseId, approverId, approver.approval_role, actorId],
    );
    await this.pool.query(
      `DELETE FROM approval_reminders WHERE release_id = $1 AND approver_id = $2`,
      [releaseId, approverId],
    );
    await this.notifications
      .sendThreadedEmail(
        [approver.email],
        `Release ${release.version} — re-approval requested`,
        `<p>Your prior ${ROLE_LABEL[approver.approval_role] || approver.approval_role} sign-off on release <b>${release.version}</b> was reset — please review and re-approve.</p>`,
        this.threadId(releaseId),
      )
      .catch(() => undefined);
    return this.status(releaseId);
  }

  /** Every decision change (submit, delegate, expire, re-request) for a release, newest first. */
  async history(releaseId: string) {
    const { rows } = await this.pool.query(
      `SELECT h.*, u.email AS approver_email, act.email AS actor_email
         FROM release_approval_history h
         LEFT JOIN users u ON u.id = h.approver_id
         LEFT JOIN users act ON act.id = h.actor_id
        WHERE h.release_id = $1
        ORDER BY h.occurred_at DESC`,
      [releaseId],
    );
    return rows;
  }

  /** A previously-approved sign-off older than APPROVAL_EXPIRY_DAYS is stale — expire it, requiring re-approval. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredApprovals() {
    const { rows } = await this.pool.query(
      `UPDATE release_approvals SET decision = 'expired', updated_at = now()
        WHERE decision = 'approved' AND expires_at IS NOT NULL AND expires_at <= now()
        RETURNING release_id, approver_id, approval_role`,
    );
    for (const r of rows) {
      await this.pool.query(
        `INSERT INTO release_approval_history (release_id, approver_id, approval_role, decision, note)
         VALUES ($1,$2,$3,'expired','sign-off expired, re-approval required')`,
        [r.release_id, r.approver_id, r.approval_role],
      );
    }
  }

  /** Nudge approvers who still haven't decided (or expired) after APPROVAL_REMINDER_HOURS of silence. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepApprovalReminders() {
    const reminderHours = Number(process.env.APPROVAL_REMINDER_HOURS) || 48;
    const { rows: openReleases } = await this.pool.query(
      `SELECT id, version FROM releases WHERE archived_at IS NULL AND status <> 'archived'`,
    );
    for (const rel of openReleases) {
      const stat = await this.status(rel.id);
      if (stat.fully_approved || stat.required_count === 0) continue;
      for (const a of stat.approvers) {
        if (a.decision === 'approved') continue;
        const last = await this.pool.query(
          `SELECT last_reminded_at FROM approval_reminders WHERE release_id = $1 AND approver_id = $2`,
          [rel.id, a.approver_id],
        );
        const lastAt = last.rows[0]?.last_reminded_at;
        if (lastAt && Date.now() - new Date(lastAt).getTime() < reminderHours * 3_600_000) continue;
        await this.pool.query(
          `INSERT INTO approval_reminders (release_id, approver_id, last_reminded_at) VALUES ($1,$2,now())
           ON CONFLICT (release_id, approver_id) DO UPDATE SET last_reminded_at = now()`,
          [rel.id, a.approver_id],
        );
        await this.notifications
          .sendThreadedEmail(
            [a.email],
            `Reminder: Release ${rel.version} — Approvals`,
            `<p>Your ${a.role_label} sign-off on release <b>${rel.version}</b> is still <b>${a.decision}</b>. Please review.</p>`,
            this.threadId(rel.id),
          )
          .catch(() => undefined);
      }
    }
  }

  /** Notify every required approver (threaded email) + chat channels. */
  private async notifyApproval(status: any, actor: any, decision: string, remark?: string) {
    const recipients = [...new Set(status.approvers.map((a: any) => a.email))] as string[];
    const roleLabel = ROLE_LABEL[actor.approval_role] || actor.approval_role;
    const subject = `Release ${status.release_version} — Approvals`;
    const rows = status.approvers
      .map((a: any) => `<tr><td>${a.role_label}</td><td>${a.email}</td><td>${a.decision}</td><td>${a.remark || ''}</td></tr>`)
      .join('');
    const html = `
      <p><b>${actor.email}</b> (${roleLabel}) <b>${decision}</b> release <b>${status.release_version}</b>.${remark ? `<br/>Remark: ${remark}` : ''}</p>
      <p>${status.approved_count}/${status.required_count} approved.${status.fully_approved ? ' <b>✅ Fully approved.</b>' : ''}${status.rejected ? ' <b>❌ A rejection is recorded.</b>' : ''}</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <tr><th>Role</th><th>Approver</th><th>Decision</th><th>Remark</th></tr>${rows}
      </table>`;

    // Same-thread email to all approvers.
    await this.notifications.sendThreadedEmail(recipients, subject, html, this.threadId(status.release_id));

    // Chat channels subscribed to approval events.
    await this.notifications.notifyEvent('release.approval_submitted', {
      title: `Release ${status.release_version}: ${roleLabel} ${decision}`,
      lines: [
        `${actor.email} (${roleLabel}) ${decision}.`,
        `${status.approved_count}/${status.required_count} approved.`,
        remark ? `Remark: ${remark}` : '',
      ].filter(Boolean),
      severity: decision === 'rejected' ? 'warning' : 'info',
    });

    if (status.fully_approved) {
      await this.notifications.notifyEvent('release.fully_approved', {
        title: `Release ${status.release_version} fully approved ✅`,
        lines: [`All ${status.required_count} approvers signed off.`],
        severity: 'success',
      });
    }
  }

  async list(releaseId: string) {
    return (await this.status(releaseId)).approvers;
  }

  /** Fetch an attachment's bytes for download. */
  async attachment(id: string) {
    const { rows } = await this.pool.query(
      `SELECT filename, content_type, data FROM release_approval_attachments WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Attachment not found');
    return rows[0] as { filename: string; content_type: string; data: Buffer };
  }
}
