import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { GitService } from './git.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from './approvals.service';

const ACTIVE_STATUSES = ['pending', 'approved', 'in_progress'];
const TERMINAL_STATUSES = ['succeeded', 'failed', 'rolled_back', 'cancelled'];

@Injectable()
export class DeploymentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly git: GitService,
    private readonly rt: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
  ) {}

  listChannels() {
    return this.pool
      .query(`SELECT * FROM channels ORDER BY rank`)
      .then((r) => r.rows);
  }

  /** Flat deployment list, most recent first. */
  list() {
    return this.pool
      .query(
        `SELECT d.*, c.key AS channel_key, c.name AS channel_name, c.rank AS channel_rank,
                r.version AS release_version, r.name AS release_name,
                ua.email AS approved_by_email, ut.email AS triggered_by_email
           FROM deployments d
           JOIN channels c ON c.id = d.channel_id
           JOIN releases r ON r.id = d.release_id
           LEFT JOIN users ua ON ua.id = d.approved_by
           LEFT JOIN users ut ON ut.id = d.triggered_by
          ORDER BY d.created_at DESC`,
      )
      .then((r) => r.rows);
  }

  /**
   * Channel pipeline board: for each channel, the current (latest succeeded)
   * deployment plus the latest deployment of any status.
   */
  async board() {
    const channels = await this.listChannels();
    const out: Array<{ channel: any; current: any; latest: any }> = [];
    for (const ch of channels) {
      const current = await this.pool.query(
        `SELECT d.*, r.version AS release_version, r.name AS release_name
           FROM deployments d JOIN releases r ON r.id = d.release_id
          WHERE d.channel_id = $1 AND d.status = 'succeeded'
          ORDER BY d.finished_at DESC NULLS LAST, d.created_at DESC
          LIMIT 1`,
        [ch.id],
      );
      const latest = await this.pool.query(
        `SELECT d.*, r.version AS release_version, r.name AS release_name
           FROM deployments d JOIN releases r ON r.id = d.release_id
          WHERE d.channel_id = $1
          ORDER BY d.created_at DESC
          LIMIT 1`,
        [ch.id],
      );
      out.push({
        channel: ch,
        current: current.rows[0] ?? null,
        latest: latest.rows[0] ?? null,
      });
    }
    return out;
  }

  async history(deploymentId: string) {
    const { rows } = await this.pool.query(
      `SELECT h.*, u.email AS actor_email
         FROM deployment_history h
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.deployment_id = $1
        ORDER BY h.occurred_at`,
      [deploymentId],
    );
    return rows;
  }

  /** Create a deployment of a release to a channel. */
  async deploy(
    releaseId: string,
    input: {
      channel: string;
      server_ids?: string[];
      branch?: string;
      custom_commands?: string[];
    },
    userId?: string,
    actorRole?: string,
  ) {
    const rel = await this.pool.query(
      `SELECT * FROM releases WHERE id = $1`,
      [releaseId],
    );
    if (!rel.rows[0]) throw new NotFoundException('Release not found');
    if (rel.rows[0].status === 'archived') {
      throw new BadRequestException('Cannot deploy an archived release');
    }
    // Hard approval gate (admin overrides).
    if (actorRole !== 'admin' && !(await this.approvals.isFullyApproved(releaseId))) {
      throw new BadRequestException(
        'Release is not fully approved (QA, BA, DEV Lead and Tech Lead must all sign off). An admin can override.',
      );
    }
    const ch = await this.pool.query(
      `SELECT * FROM channels WHERE key = $1`,
      [input.channel],
    );
    if (!ch.rows[0]) throw new NotFoundException('Channel not found');
    const channel = ch.rows[0];
    await this.assertChannelFree(channel.id);

    // previous_version / rollback_target = last succeeded deploy on this channel
    const prev = await this.pool.query(
      `SELECT r.version FROM deployments d JOIN releases r ON r.id = d.release_id
        WHERE d.channel_id = $1 AND d.status = 'succeeded'
        ORDER BY d.finished_at DESC NULLS LAST, d.created_at DESC LIMIT 1`,
      [channel.id],
    );
    const previousVersion = prev.rows[0]?.version ?? null;

    let dep: any;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO deployments
           (release_id, channel_id, status, current_version, previous_version,
            rollback_target, triggered_by)
         VALUES ($1,$2,'pending',$3,$4,$4,$5)
         RETURNING *`,
        [releaseId, channel.id, rel.rows[0].version, previousVersion, userId ?? null],
      );
      dep = rows[0];
    } catch (e: any) {
      if (e.code === '23505') this.throwChannelBusy();
      throw e;
    }
    await this.recordHistory(dep.id, null, 'pending', userId, 'created');

    // Agent-executed pipeline: one job per (selected server × pinned repo).
    let jobCount = 0;
    if (input.server_ids?.length) {
      jobCount = await this.createJobs(
        dep,
        channel,
        input.server_ids,
        input.branch,
        input.custom_commands ?? [],
      );
    }

    this.rt.emitReleaseEvent('deployment.created', {
      ...dep,
      channel_key: channel.key,
      job_count: jobCount,
    });

    // Channels that don't require approval execute immediately.
    if (!channel.requires_approval) {
      return this.execute(dep.id, userId);
    }
    return dep;
  }

  /**
   * Create one deploy job per (server × repository pinned in the release).
   * The agent on each server pulls and runs these. Returns the number created.
   */
  private async createJobs(
    dep: any,
    channel: any,
    serverIds: string[],
    branchOverride: string | undefined,
    customCommands: string[],
  ): Promise<number> {
    const repos = await this.pool.query(
      `SELECT rr.repository_id, rr.commit_sha, rr.branch_name, rp.slug
         FROM release_repositories rr
         JOIN repositories rp ON rp.id = rr.repository_id
        WHERE rr.release_id = $1`,
      [dep.release_id],
    );
    if (repos.rows.length === 0) return 0; // nothing pinned -> caller keeps legacy path
    // On-server environment directory. Override per server via tags.env_path.
    const defaultEnvPath = `oms-${channel.key}`;
    let count = 0;
    for (const serverId of serverIds) {
      const srv = await this.pool.query(
        `SELECT tags FROM servers WHERE id = $1`,
        [serverId],
      );
      // Per-server env-dir override lives in the server's tags, e.g. tags.env_path.
      const envPath = srv.rows[0]?.tags?.env_path || defaultEnvPath;
      for (const repo of repos.rows) {
        await this.pool.query(
          `INSERT INTO deploy_jobs
             (deployment_id, server_id, repository_id, repo_slug, env_key, env_path,
              branch, commit_sha, custom_commands, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
          [
            dep.id,
            serverId,
            repo.repository_id,
            repo.slug,
            channel.key,
            envPath,
            branchOverride || repo.branch_name || null,
            repo.commit_sha || null,
            JSON.stringify(customCommands),
          ],
        );
        count++;
      }
    }
    return count;
  }

  // ── Agent job APIs (called by the on-server agent, X-Api-Key auth) ──────────

  /**
   * Atomically claim up to `limit` pending jobs for a server whose parent
   * deployment is currently executing. Returns the job specs for the agent.
   */
  async claimJobsForServer(serverId: string, limit = 5) {
    const { rows } = await this.pool.query(
      `UPDATE deploy_jobs j
          SET status = 'claimed', claimed_at = now()
        WHERE j.id IN (
          SELECT j2.id FROM deploy_jobs j2
            JOIN deployments d ON d.id = j2.deployment_id
           WHERE j2.server_id = $1
             AND j2.status = 'pending'
             AND d.status = 'in_progress'
           ORDER BY j2.created_at
           LIMIT $2
        )
        RETURNING id, deployment_id, repo_slug, env_key, env_path,
                  branch, commit_sha, custom_commands`,
      [serverId, limit],
    );
    return rows;
  }

  /** Agent reports a job's result; settle the parent deployment when all done. */
  async reportJobResult(
    jobId: string,
    serverId: string,
    body: { status: 'running' | 'succeeded' | 'failed'; steps?: any[]; log?: string; error?: string },
  ) {
    const { rows } = await this.pool.query(
      `UPDATE deploy_jobs
          SET status = $3,
              steps = COALESCE($4::jsonb, steps),
              log = COALESCE($5, log),
              error = $6,
              started_at = COALESCE(started_at, CASE WHEN $3 = 'running' THEN now() ELSE started_at END),
              finished_at = CASE WHEN $3 IN ('succeeded','failed') THEN now() ELSE finished_at END
        WHERE id = $1 AND server_id = $2
        RETURNING deployment_id, status`,
      [jobId, serverId, body.status, body.steps ? JSON.stringify(body.steps) : null, body.log ?? null, body.error ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Job not found for this server');
    if (body.status === 'succeeded' || body.status === 'failed') {
      await this.settleDeployment(rows[0].deployment_id);
    }
    return { ok: true };
  }

  /** Settle a deployment once all its jobs have finished. */
  private async settleDeployment(deploymentId: string) {
    const { rows } = await this.pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status IN ('pending','claimed','running'))::int AS open,
         count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM deploy_jobs WHERE deployment_id = $1`,
      [deploymentId],
    );
    const { total, open, failed } = rows[0];
    if (total === 0 || open > 0) return; // still running
    const finalStatus = failed > 0 ? 'failed' : 'succeeded';
    const dep = await this.getRaw(deploymentId);
    if (TERMINAL_STATUSES.includes(dep.status)) return; // already settled (or cancelled)
    await this.pool.query(
      `UPDATE deployments SET status = $2, finished_at = now() WHERE id = $1`,
      [deploymentId, finalStatus],
    );
    await this.recordHistory(deploymentId, dep.status, finalStatus, undefined, 'agent jobs settled');
    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [dep.channel_id]);
    const channelKey = ch.rows[0]?.key;
    this.rt.emitReleaseEvent(`deployment.${finalStatus}`, { id: deploymentId, channel_key: channelKey });
    this.notifications
      .notifyEvent(finalStatus === 'succeeded' ? 'deployment.successful' : 'deployment.failed', {
        title: `Deployment ${finalStatus} — ${dep.current_version} → ${channelKey}`,
        lines: [
          `Release *${dep.current_version}* to *${channelKey}*: ${finalStatus}.`,
          `${total} agent job(s), ${failed} failed.`,
        ],
        severity: finalStatus === 'succeeded' ? 'success' : 'critical',
      })
      .catch(() => undefined);
  }

  /** Jobs for a deployment (UI). */
  listJobs(deploymentId: string) {
    return this.pool
      .query(
        `SELECT j.id, j.repo_slug, j.env_key, j.env_path, j.branch, j.commit_sha,
                j.status, j.steps, j.error, j.started_at, j.finished_at,
                s.name AS server_name
           FROM deploy_jobs j
           JOIN servers s ON s.id = j.server_id
          WHERE j.deployment_id = $1
          ORDER BY s.name, j.repo_slug`,
        [deploymentId],
      )
      .then((r) => r.rows);
  }

  /** Full log for a single job (UI drill-in). */
  async jobLog(jobId: string) {
    const { rows } = await this.pool.query(
      `SELECT log, steps, error FROM deploy_jobs WHERE id = $1`,
      [jobId],
    );
    if (!rows[0]) throw new NotFoundException('Job not found');
    return rows[0];
  }

  /** Approve a pending deployment, then execute it. */
  async approve(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (dep.status !== 'pending') {
      throw new BadRequestException(
        `Only pending deployments can be approved (is "${dep.status}")`,
      );
    }
    await this.pool.query(
      `UPDATE deployments SET status = 'approved', approved_by = $2 WHERE id = $1`,
      [deploymentId, userId ?? null],
    );
    await this.recordHistory(deploymentId, 'pending', 'approved', userId);
    return this.execute(deploymentId, userId);
  }

  /**
   * Start execution. If the deployment has agent jobs, mark it in_progress and
   * return — the on-server agents claim the jobs, run the pipeline, and report
   * back (settleDeployment finalizes). Otherwise fall back to the legacy stub
   * executor and settle inline.
   */
  private async execute(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [
      dep.channel_id,
    ]);
    await this.pool.query(
      `UPDATE deployments SET status = 'in_progress', started_at = now() WHERE id = $1`,
      [deploymentId],
    );
    await this.recordHistory(deploymentId, 'approved', 'in_progress', userId);

    // Agent mode: hand off to on-server agents (jobs are now claimable).
    const jobs = await this.pool.query(
      `SELECT count(*)::int AS n FROM deploy_jobs WHERE deployment_id = $1`,
      [deploymentId],
    );
    if (jobs.rows[0].n > 0) {
      this.rt.emitReleaseEvent('deployment.in_progress', {
        id: deploymentId,
        channel_key: ch.rows[0]?.key,
        jobs: jobs.rows[0].n,
      });
      return this.getRaw(deploymentId);
    }

    const result = await this.git.execDeploy({
      releaseVersion: dep.current_version,
      channel: ch.rows[0]?.key,
      deploymentId,
    });

    const finalStatus = result.ok ? 'succeeded' : 'failed';
    const { rows } = await this.pool.query(
      `UPDATE deployments
          SET status = $2, finished_at = now(), logs_url = $3
        WHERE id = $1 RETURNING *`,
      [deploymentId, finalStatus, result.logs_url],
    );
    await this.recordHistory(deploymentId, 'in_progress', finalStatus, userId);
    const channelKey = ch.rows[0]?.key;
    this.rt.emitReleaseEvent(`deployment.${finalStatus}`, {
      ...rows[0],
      channel_key: channelKey,
    });
    // Fan out to subscribed notification channels.
    this.notifications
      .notifyEvent(result.ok ? 'deployment.successful' : 'deployment.failed', {
        title: `Deployment ${result.ok ? 'succeeded' : 'failed'} — ${dep.current_version} → ${channelKey}`,
        lines: [
          `Release *${dep.current_version}* to *${channelKey}*: ${finalStatus}.`,
          result.logs_url ? `Logs: ${result.logs_url}` : '',
        ].filter(Boolean),
        severity: result.ok ? 'success' : 'critical',
      })
      .catch(() => undefined);
    return rows[0];
  }

  /**
   * One-click rollback: mark this deployment rolled_back and create a new
   * succeeded deployment re-promoting the pre-computed rollback target (no
   * rebuild — the prior pinned artifact moves back to the channel head).
   */
  async rollback(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (!dep.rollback_target) {
      throw new BadRequestException('No rollback target recorded for this deployment');
    }
    const target = await this.pool.query(
      `SELECT * FROM releases WHERE version = $1`,
      [dep.rollback_target],
    );
    if (!target.rows[0]) {
      throw new BadRequestException(
        `Rollback target release ${dep.rollback_target} not found`,
      );
    }
    await this.pool.query(
      `UPDATE deployments SET status = 'rolled_back', finished_at = now() WHERE id = $1`,
      [deploymentId],
    );
    await this.recordHistory(
      deploymentId,
      dep.status,
      'rolled_back',
      userId,
      `rolled back to ${dep.rollback_target}`,
    );

    const { rows } = await this.pool.query(
      `INSERT INTO deployments
         (release_id, channel_id, status, current_version, previous_version,
          rollback_target, approved_by, triggered_by, started_at, finished_at)
       VALUES ($1,$2,'succeeded',$3,$4,$4,$5,$5, now(), now())
       RETURNING *`,
      [
        target.rows[0].id,
        dep.channel_id,
        dep.rollback_target,
        dep.current_version,
        userId ?? null,
      ],
    );
    await this.recordHistory(rows[0].id, null, 'succeeded', userId, 'rollback redeploy');
    this.rt.emitReleaseEvent('deployment.rolled_back', {
      original: deploymentId,
      redeploy: rows[0],
    });
    return rows[0];
  }

  /** Stop a deployment that hasn't finished: any still-open agent jobs are cancelled so agents skip them. */
  async cancel(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (!ACTIVE_STATUSES.includes(dep.status)) {
      throw new BadRequestException(
        `Only pending/approved/in_progress deployments can be cancelled (is "${dep.status}")`,
      );
    }
    await this.pool.query(
      `UPDATE deployments SET status = 'cancelled', finished_at = now() WHERE id = $1`,
      [deploymentId],
    );
    await this.pool.query(
      `UPDATE deploy_jobs SET status = 'cancelled', finished_at = now()
        WHERE deployment_id = $1 AND status IN ('pending','claimed','running')`,
      [deploymentId],
    );
    await this.recordHistory(deploymentId, dep.status, 'cancelled', userId, 'cancelled by operator');
    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [dep.channel_id]);
    const channelKey = ch.rows[0]?.key;
    this.rt.emitReleaseEvent('deployment.cancelled', { id: deploymentId, channel_key: channelKey });
    this.notifications
      .notifyEvent('deployment.cancelled', {
        title: `Deployment cancelled — ${dep.current_version} → ${channelKey}`,
        lines: [`Release *${dep.current_version}* deployment to *${channelKey}* was cancelled.`],
        severity: 'warning',
      })
      .catch(() => undefined);
    return this.getRaw(deploymentId);
  }

  /** Re-run only the jobs that didn't succeed on a failed deployment (no new deployment row). */
  async retry(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (dep.status !== 'failed') {
      throw new BadRequestException(`Only failed deployments can be retried (is "${dep.status}")`);
    }
    await this.assertChannelFree(dep.channel_id, deploymentId);
    const failedJobs = await this.pool.query(
      `SELECT server_id, repository_id, repo_slug, env_key, env_path, branch, commit_sha, custom_commands
         FROM deploy_jobs WHERE deployment_id = $1 AND status <> 'succeeded'`,
      [deploymentId],
    );
    if (failedJobs.rows.length === 0) {
      throw new BadRequestException('No failed jobs to retry on this deployment');
    }
    for (const j of failedJobs.rows) {
      await this.pool.query(
        `INSERT INTO deploy_jobs
           (deployment_id, server_id, repository_id, repo_slug, env_key, env_path,
            branch, commit_sha, custom_commands, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
        [
          deploymentId, j.server_id, j.repository_id, j.repo_slug, j.env_key, j.env_path,
          j.branch, j.commit_sha, JSON.stringify(j.custom_commands ?? []),
        ],
      );
    }
    await this.pool.query(
      `UPDATE deployments SET status = 'in_progress', finished_at = NULL WHERE id = $1`,
      [deploymentId],
    );
    await this.recordHistory(deploymentId, 'failed', 'in_progress', userId, `retrying ${failedJobs.rows.length} job(s)`);
    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [dep.channel_id]);
    this.rt.emitReleaseEvent('deployment.in_progress', {
      id: deploymentId, channel_key: ch.rows[0]?.key, retried: failedJobs.rows.length,
    });
    return this.getRaw(deploymentId);
  }

  /** Reject if this channel already has a non-terminal deployment (optionally excluding one, for retry). */
  private async assertChannelFree(channelId: string, excludeId?: string) {
    const { rows } = await this.pool.query(
      `SELECT id, status FROM deployments
        WHERE channel_id = $1 AND status IN ('pending','approved','in_progress')
          AND ($2::uuid IS NULL OR id <> $2::uuid)
        LIMIT 1`,
      [channelId, excludeId ?? null],
    );
    if (rows[0]) this.throwChannelBusy(rows[0].status);
  }

  private throwChannelBusy(status?: string): never {
    throw new BadRequestException(
      `This channel already has an active deployment${status ? ` (${status})` : ''} — cancel or wait for it to finish first.`,
    );
  }

  /**
   * Fail agent jobs an agent never reported back on (crashed/network-partitioned) so
   * the deployment doesn't hang in_progress forever. DEPLOY_JOB_TIMEOUT_MINUTES (default 15).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepStaleJobs() {
    const timeoutMin = Number(process.env.DEPLOY_JOB_TIMEOUT_MINUTES) || 15;
    const { rows } = await this.pool.query(
      `UPDATE deploy_jobs
          SET status = 'failed', error = 'timed out — agent unresponsive', finished_at = now()
        WHERE status IN ('claimed','running')
          AND COALESCE(started_at, claimed_at) < now() - ($1 || ' minutes')::interval
        RETURNING deployment_id`,
      [timeoutMin],
    );
    const deploymentIds = new Set<string>(rows.map((r) => r.deployment_id));
    for (const id of deploymentIds) {
      await this.settleDeployment(id);
    }
  }

  private async getRaw(id: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM deployments WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Deployment not found');
    return rows[0];
  }

  private async recordHistory(
    deploymentId: string,
    from: string | null,
    to: string,
    actorId?: string,
    note?: string,
  ) {
    await this.pool.query(
      `INSERT INTO deployment_history (deployment_id, from_status, to_status, actor_id, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [deploymentId, from, to, actorId ?? null, note ?? null],
    );
  }
}
