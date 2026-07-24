import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
              u.email AS approver_email,
              COALESCE(json_agg(json_build_object('id', att.id, 'filename', att.filename)
                       ORDER BY att.created_at) FILTER (WHERE att.id IS NOT NULL), '[]') AS attachments
         FROM release_approvals a
         JOIN users u ON u.id = a.approver_id
         LEFT JOIN release_approval_attachments att ON att.approval_id = a.id
        WHERE a.release_id = $1
        GROUP BY a.id, u.email`,
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

  /** Submit (or update) the current user's decision, with optional remark + file. */
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
    if (!me.approval_role) throw new ForbiddenException('You have no approval role assigned');

    const required = await this.requiredApprovers(releaseId);
    if (!required.some((r) => r.id === userId)) {
      throw new ForbiddenException('You are not a required approver for this release (check your product assignment)');
    }

    const approval = await this.pool
      .query(
        `INSERT INTO release_approvals (release_id, approver_id, approval_role, decision, remark)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (release_id, approver_id)
         DO UPDATE SET decision = EXCLUDED.decision, remark = EXCLUDED.remark, updated_at = now()
         RETURNING id`,
        [releaseId, userId, me.approval_role, decision, body.remark ?? null],
      )
      .then((r) => r.rows[0]);

    if (file && file.buffer) {
      await this.pool.query(
        `INSERT INTO release_approval_attachments (approval_id, filename, content_type, size, data)
         VALUES ($1,$2,$3,$4,$5)`,
        [approval.id, file.originalname, file.mimetype, file.size, file.buffer],
      );
    }

    const status = await this.status(releaseId);
    await this.notifyApproval(status, me, decision, body.remark);
    return status;
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
