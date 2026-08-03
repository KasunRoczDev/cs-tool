import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { GitService } from './git.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from './approvals.service';
import { CalendarService } from './calendar.service';
import { EnvironmentService } from './environment.service';

const ACTIVE_STATUSES = ['pending', 'approved', 'in_progress', 'scheduled', 'awaiting_promotion'];
const TERMINAL_STATUSES = ['succeeded', 'failed', 'rolled_back', 'cancelled'];

@Injectable()
export class DeploymentsService {
  private readonly log = new Logger(DeploymentsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly git: GitService,
    private readonly rt: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    private readonly calendar: CalendarService,
    private readonly environment: EnvironmentService,
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

  // ==================== DORA metrics ====================
  // Computed on the fly from deployments/deployment_history/releases — deploy
  // volume is naturally low compared to raw server metrics, so a rollup table
  // would be premature. Tier thresholds follow the commonly-published DORA
  // bands (2019/2022 State of DevOps reports).

  private static classifyDeployFrequency(perWeek: number): string {
    if (perWeek >= 7) return 'Elite';
    if (perWeek >= 1) return 'High';
    if (perWeek >= 0.23) return 'Medium'; // roughly monthly
    return 'Low';
  }

  private static classifyLeadTime(seconds: number | null): string {
    if (seconds == null) return 'N/A';
    const day = 86400;
    if (seconds < day) return 'Elite';
    if (seconds < 7 * day) return 'High';
    if (seconds < 30 * day) return 'Medium';
    return 'Low';
  }

  private static classifyChangeFailureRate(pct: number | null): string {
    if (pct == null) return 'N/A';
    if (pct <= 15) return 'Elite';
    if (pct <= 30) return 'High';
    if (pct <= 45) return 'Medium';
    return 'Low';
  }

  private static classifyMttr(seconds: number | null): string {
    if (seconds == null) return 'N/A';
    const hour = 3600;
    const day = 86400;
    const week = 7 * day;
    if (seconds < hour) return 'Elite';
    if (seconds < day) return 'High';
    if (seconds < week) return 'Medium';
    return 'Low';
  }

  /**
   * Deployment Frequency, Lead Time for Changes, Change Failure Rate, and MTTR
   * for one channel over a trailing window.
   *
   * - Lead time = release.created_at -> deployment.finished_at (median). This
   *   approximates DORA's commit-to-deploy lead time — we don't have a
   *   reliable first-commit timestamp without live GitHub calls per repo, so
   *   release-creation is the practical stand-in.
   * - MTTR = mean time from a deployment entering failed/rolled_back
   *   (deployment_history) to that same deployment later reaching succeeded —
   *   covers the retry flow, where a failed deployment is retried in place
   *   rather than becoming a new row.
   */
  async metrics(channelKey = 'production', days = 30) {
    const ch = await this.pool.query(`SELECT id FROM channels WHERE key = $1`, [channelKey]);
    if (!ch.rows[0]) throw new NotFoundException('Channel not found');

    const [freqRes, leadRes, cfrRes, mttrRes, durationRes, rollbackRes] = await Promise.all([
      this.pool.query(
        `SELECT date_trunc('day', d.finished_at)::date AS day, count(*)::int AS n
           FROM deployments d JOIN channels c ON c.id = d.channel_id
          WHERE c.key = $1 AND d.status = 'succeeded'
            AND d.finished_at >= now() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY 1`,
        [channelKey, days],
      ),
      this.pool.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (d.finished_at - r.created_at))
          ) AS median_seconds
           FROM deployments d
           JOIN channels c ON c.id = d.channel_id
           JOIN releases r ON r.id = d.release_id
          WHERE c.key = $1 AND d.status = 'succeeded'
            AND d.finished_at >= now() - ($2 || ' days')::interval`,
        [channelKey, days],
      ),
      this.pool.query(
        `SELECT
            count(*) FILTER (WHERE d.status IN ('failed','rolled_back'))::int AS failed,
            count(*) FILTER (WHERE d.status IN ('succeeded','failed','rolled_back'))::int AS total
           FROM deployments d JOIN channels c ON c.id = d.channel_id
          WHERE c.key = $1 AND d.created_at >= now() - ($2 || ' days')::interval`,
        [channelKey, days],
      ),
      this.pool.query(
        `WITH fails AS (
            SELECT dh.deployment_id, dh.occurred_at AS failed_at
              FROM deployment_history dh
              JOIN deployments d ON d.id = dh.deployment_id
              JOIN channels c ON c.id = d.channel_id
             WHERE c.key = $1 AND dh.to_status IN ('failed','rolled_back')
               AND dh.occurred_at >= now() - ($2 || ' days')::interval
          ),
          recoveries AS (
            SELECT f.deployment_id, f.failed_at,
              (SELECT min(dh2.occurred_at) FROM deployment_history dh2
                WHERE dh2.deployment_id = f.deployment_id AND dh2.to_status = 'succeeded'
                  AND dh2.occurred_at > f.failed_at) AS recovered_at
              FROM fails f
          )
          SELECT
            avg(EXTRACT(EPOCH FROM (recovered_at - failed_at))) FILTER (WHERE recovered_at IS NOT NULL) AS mttr_seconds,
            count(*) FILTER (WHERE recovered_at IS NOT NULL)::int AS recovered_count,
            count(*)::int AS incident_count
            FROM recoveries`,
        [channelKey, days],
      ),
      this.pool.query(
        `SELECT avg(EXTRACT(EPOCH FROM (d.finished_at - d.started_at))) AS mean_seconds
           FROM deployments d JOIN channels c ON c.id = d.channel_id
          WHERE c.key = $1 AND d.status = 'succeeded' AND d.started_at IS NOT NULL
            AND d.finished_at >= now() - ($2 || ' days')::interval`,
        [channelKey, days],
      ),
      this.pool.query(
        `SELECT
            count(*) FILTER (WHERE d.status = 'rolled_back')::int AS rolled_back,
            count(*) FILTER (WHERE d.status IN ('succeeded','failed','rolled_back'))::int AS total
           FROM deployments d JOIN channels c ON c.id = d.channel_id
          WHERE c.key = $1 AND d.created_at >= now() - ($2 || ' days')::interval`,
        [channelKey, days],
      ),
    ]);

    const series = freqRes.rows.map((r: any) => ({ day: r.day, count: r.n }));
    const deployCount = series.reduce((sum: number, r: any) => sum + r.count, 0);
    const perWeek = (deployCount / days) * 7;

    const leadSecondsRaw = leadRes.rows[0]?.median_seconds;
    const leadSeconds = leadSecondsRaw != null ? Number(leadSecondsRaw) : null;

    const { failed, total } = cfrRes.rows[0];
    const cfrPct = total > 0 ? (failed / total) * 100 : null;

    const mttrRow = mttrRes.rows[0];
    const mttrSeconds = mttrRow?.mttr_seconds != null ? Number(mttrRow.mttr_seconds) : null;

    const durationSeconds = durationRes.rows[0]?.mean_seconds != null ? Number(durationRes.rows[0].mean_seconds) : null;
    const { rolled_back: rolledBack, total: rollbackTotal } = rollbackRes.rows[0];
    const rollbackPct = rollbackTotal > 0 ? (rolledBack / rollbackTotal) * 100 : null;

    return {
      channel: channelKey,
      window_days: days,
      deployment_frequency: {
        count: deployCount,
        per_week: Math.round(perWeek * 100) / 100,
        series,
        tier: DeploymentsService.classifyDeployFrequency(perWeek),
      },
      lead_time_for_changes: {
        median_seconds: leadSeconds,
        tier: DeploymentsService.classifyLeadTime(leadSeconds),
      },
      change_failure_rate: {
        failed,
        total,
        percent: cfrPct != null ? Math.round(cfrPct * 10) / 10 : null,
        tier: DeploymentsService.classifyChangeFailureRate(cfrPct),
      },
      mttr: {
        mean_seconds: mttrSeconds,
        incident_count: mttrRow.incident_count,
        recovered_count: mttrRow.recovered_count,
        tier: DeploymentsService.classifyMttr(mttrSeconds),
      },
      // Not part of the classic 4 DORA metrics (no standard tier bands) — raw supplementary reports.
      mean_deployment_duration: {
        mean_seconds: durationSeconds,
      },
      rollback_frequency: {
        rolled_back: rolledBack,
        total: rollbackTotal,
        percent: rollbackPct != null ? Math.round(rollbackPct * 10) / 10 : null,
      },
    };
  }

  /** Products of a release's pinned repositories — used for freeze-window scoping. */
  private async releaseProductIds(releaseId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT rp.product_id FROM release_repositories rr
         JOIN repositories rp ON rp.id = rr.repository_id
        WHERE rr.release_id = $1 AND rp.product_id IS NOT NULL`,
      [releaseId],
    );
    return rows.map((r: any) => r.product_id);
  }

  private freezeMessage(freeze: any): string {
    const range = `${new Date(freeze.starts_at).toLocaleString()} – ${new Date(freeze.ends_at).toLocaleString()}`;
    return `Blocked by freeze window "${freeze.name}" (${range})${freeze.reason ? `: ${freeze.reason}` : ''}. An admin can override.`;
  }

  /**
   * Split target servers into deploy waves for a strategy. Blue-Green/A-B/
   * Shadow aren't modeled — they need real traffic-splitting infrastructure
   * (load balancer / service mesh) this platform doesn't integrate with.
   */
  private computeWaves(serverIds: string[], strategy: string, config: Record<string, any>): string[][] {
    if (strategy === 'rolling') {
      const batchSize = Math.max(1, Math.floor(Number(config?.batch_size)) || 1);
      const waves: string[][] = [];
      for (let i = 0; i < serverIds.length; i += batchSize) waves.push(serverIds.slice(i, i + batchSize));
      return waves.length ? waves : [serverIds];
    }
    if (strategy === 'canary') {
      const canaryCount = Math.min(serverIds.length, Math.max(1, Math.floor(Number(config?.canary_count)) || 1));
      const first = serverIds.slice(0, canaryCount);
      const rest = serverIds.slice(canaryCount);
      return rest.length ? [first, rest] : [first];
    }
    return [serverIds]; // all_at_once
  }

  /**
   * Create a deployment of a release to a channel. With `scheduled_at`, the
   * deployment is created in the `scheduled` status and executed automatically
   * by sweepScheduledDeployments() once that time arrives — scheduling is
   * treated as the approval decision, so it doesn't wait for a manual Approve
   * click even on channels that require one.
   *
   * `strategy` ('all_at_once' | 'rolling' | 'canary') splits `server_ids`
   * into waves (see computeWaves). Rolling auto-advances to the next wave
   * once the current one fully succeeds; canary pauses in
   * `awaiting_promotion` after its (usually small) first wave and waits for
   * POST /deployments/:id/promote-wave. A wave failure fails the whole
   * deployment and cancels any not-yet-started later-wave jobs.
   */
  async deploy(
    releaseId: string,
    input: {
      channel: string;
      server_ids?: string[];
      branch?: string;
      custom_commands?: string[];
      scheduled_at?: string;
      strategy?: string;
      strategy_config?: Record<string, any>;
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
    if (channel.locked && actorRole !== 'admin') {
      throw new BadRequestException(
        `Channel is locked${channel.locked_reason ? `: ${channel.locked_reason}` : ''}. An admin can override.`,
      );
    }
    await this.assertChannelFree(channel.id);

    const strategy = input.strategy || 'all_at_once';
    if (!['all_at_once', 'rolling', 'canary'].includes(strategy)) {
      throw new BadRequestException(`Unknown strategy "${strategy}"`);
    }

    let scheduledAt: Date | null = null;
    if (input.scheduled_at) {
      scheduledAt = new Date(input.scheduled_at);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('scheduled_at must be a valid date');
      }
      if (scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('scheduled_at must be in the future');
      }
    }

    const productIds = await this.releaseProductIds(releaseId);
    const freeze = await this.calendar.activeFreeze(channel.id, productIds, scheduledAt ?? new Date());
    if (freeze && actorRole !== 'admin') {
      throw new BadRequestException(this.freezeMessage(freeze));
    }

    // previous_version / rollback_target = last succeeded deploy on this channel
    const prev = await this.pool.query(
      `SELECT r.version FROM deployments d JOIN releases r ON r.id = d.release_id
        WHERE d.channel_id = $1 AND d.status = 'succeeded'
        ORDER BY d.finished_at DESC NULLS LAST, d.created_at DESC LIMIT 1`,
      [channel.id],
    );
    const previousVersion = prev.rows[0]?.version ?? null;

    const waves = input.server_ids?.length
      ? this.computeWaves(input.server_ids, strategy, input.strategy_config || {})
      : [[]];

    const initialStatus = scheduledAt ? 'scheduled' : 'pending';
    let dep: any;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO deployments
           (release_id, channel_id, status, current_version, previous_version,
            rollback_target, triggered_by, scheduled_at, strategy, strategy_config, total_waves)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          releaseId, channel.id, initialStatus, rel.rows[0].version, previousVersion,
          userId ?? null, scheduledAt, strategy, JSON.stringify(input.strategy_config || {}), waves.length,
        ],
      );
      dep = rows[0];
    } catch (e: any) {
      if (e.code === '23505') this.throwChannelBusy();
      throw e;
    }
    await this.recordHistory(
      dep.id, null, initialStatus, userId,
      scheduledAt ? `scheduled for ${scheduledAt.toISOString()}` : 'created',
    );

    // Agent-executed pipeline: one job per (selected server × pinned repo),
    // pre-created for every wave up front. Jobs sit 'pending' until the
    // parent deployment reaches in_progress AND their wave <= current_wave —
    // agents only claim jobs that clear both, so creating later-wave jobs now
    // (even for a scheduled deploy) is harmless; they're just not claimable yet.
    let jobCount = 0;
    if (input.server_ids?.length) {
      jobCount = await this.createJobs(
        dep,
        channel,
        waves,
        input.branch,
        input.custom_commands ?? [],
      );
    }

    this.rt.emitReleaseEvent(scheduledAt ? 'deployment.scheduled' : 'deployment.created', {
      ...dep,
      channel_key: channel.key,
      job_count: jobCount,
    });

    if (scheduledAt) return dep; // sweepScheduledDeployments executes it later

    // Channels that don't require approval execute immediately.
    if (!channel.requires_approval) {
      return this.execute(dep.id, userId);
    }
    return dep;
  }

  /**
   * Executes deployments whose scheduled_at has arrived. Re-checks freeze
   * windows at execution time (not just at scheduling time) so a window added
   * or extended after scheduling still applies — a still-frozen deployment is
   * left 'scheduled' and retried on the next sweep.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepScheduledDeployments() {
    const { rows } = await this.pool.query(
      `SELECT id, channel_id, release_id FROM deployments
        WHERE status = 'scheduled' AND scheduled_at <= now()`,
    );
    for (const dep of rows) {
      const productIds = await this.releaseProductIds(dep.release_id);
      const freeze = await this.calendar.activeFreeze(dep.channel_id, productIds, new Date());
      if (freeze) {
        this.log.warn(`Deployment ${dep.id} still frozen by "${freeze.name}" — deferring`);
        continue;
      }
      await this.pool.query(`UPDATE deployments SET status = 'approved' WHERE id = $1`, [dep.id]);
      await this.recordHistory(dep.id, 'scheduled', 'approved', undefined, 'scheduled time reached');
      await this.execute(dep.id);
    }
  }

  // ==================== Recurring deployments ====================
  // Redeploy a fixed release to a channel on a schedule (e.g. nightly
  // environment refresh) — NOT "redeploy whatever is latest," which would be
  // an ambiguous, riskier default. Each firing goes through deploy() itself,
  // so it's still gated by approval/freeze windows/channel locking exactly
  // like a manual deploy; a blocked firing is skipped, not forced through.

  async createRecurringDeployment(input: {
    release_id: string;
    channel: string;
    server_ids?: string[];
    interval_type?: string;
    day_of_week?: number;
    time_of_day: string; // 'HH:MM', UTC
    strategy?: string;
    strategy_config?: Record<string, any>;
  }, userId?: string) {
    const intervalType = input.interval_type || 'daily';
    if (!['daily', 'weekly'].includes(intervalType)) {
      throw new BadRequestException(`Unknown interval_type "${intervalType}"`);
    }
    if (intervalType === 'weekly' && (input.day_of_week == null || input.day_of_week < 0 || input.day_of_week > 6)) {
      throw new BadRequestException('day_of_week (0-6) is required for a weekly recurrence');
    }
    if (!/^\d{2}:\d{2}$/.test(input.time_of_day || '')) {
      throw new BadRequestException('time_of_day must be "HH:MM" (UTC)');
    }
    const ch = await this.pool.query(`SELECT id FROM channels WHERE key = $1`, [input.channel]);
    if (!ch.rows[0]) throw new NotFoundException('Channel not found');

    const { rows } = await this.pool.query(
      `INSERT INTO recurring_deployments
         (release_id, channel_id, server_ids, interval_type, day_of_week, time_of_day, strategy, strategy_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.release_id, ch.rows[0].id, input.server_ids ?? [], intervalType,
        intervalType === 'weekly' ? input.day_of_week : null, input.time_of_day,
        input.strategy || 'all_at_once', JSON.stringify(input.strategy_config || {}), userId ?? null,
      ],
    );
    return rows[0];
  }

  listRecurringDeployments(releaseId?: string) {
    return this.pool
      .query(
        `SELECT rd.*, c.key AS channel_key, c.name AS channel_name, r.version AS release_version
           FROM recurring_deployments rd
           JOIN channels c ON c.id = rd.channel_id
           JOIN releases r ON r.id = rd.release_id
          WHERE ($1::uuid IS NULL OR rd.release_id = $1)
          ORDER BY rd.created_at DESC`,
        [releaseId ?? null],
      )
      .then((r) => r.rows);
  }

  async setRecurringDeploymentEnabled(id: string, enabled: boolean) {
    const { rows } = await this.pool.query(
      `UPDATE recurring_deployments SET enabled = $2 WHERE id = $1 RETURNING *`,
      [id, enabled],
    );
    if (!rows[0]) throw new NotFoundException('Recurring deployment not found');
    return rows[0];
  }

  async deleteRecurringDeployment(id: string) {
    const { rowCount } = await this.pool.query(`DELETE FROM recurring_deployments WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Recurring deployment not found');
    return { deleted: true };
  }

  private isRecurringDeploymentDue(rule: any, now: Date): boolean {
    const [h, m] = String(rule.time_of_day).split(':').map(Number);
    if (now.getUTCHours() !== h || now.getUTCMinutes() !== m) return false;
    if (rule.interval_type === 'weekly' && rule.day_of_week != null && now.getUTCDay() !== rule.day_of_week) return false;
    return true;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepRecurringDeployments(now: Date = new Date()) {
    const { rows: rules } = await this.pool.query(
      `SELECT rd.*, c.key AS channel_key FROM recurring_deployments rd
         JOIN channels c ON c.id = rd.channel_id
        WHERE rd.enabled = true`,
    );
    for (const rule of rules) {
      if (!this.isRecurringDeploymentDue(rule, now)) continue;
      // Guard against firing twice for the same minute (sweep runs every minute).
      if (rule.last_run_at && now.getTime() - new Date(rule.last_run_at).getTime() < 55_000) continue;
      await this.pool.query(`UPDATE recurring_deployments SET last_run_at = now() WHERE id = $1`, [rule.id]);
      try {
        await this.deploy(
          rule.release_id,
          {
            channel: rule.channel_key,
            server_ids: rule.server_ids,
            strategy: rule.strategy,
            strategy_config: rule.strategy_config,
          },
          undefined,
          undefined, // not admin — freeze windows / channel locks / approval gate all still apply
        );
        this.log.log(`Recurring deployment ${rule.id} fired (release ${rule.release_id} → ${rule.channel_key})`);
      } catch (e: any) {
        this.log.warn(`Recurring deployment ${rule.id} skipped: ${e.message}`);
      }
    }
  }

  /**
   * Create one deploy job per (server × repository pinned in the release),
   * for every wave up front, tagged with its wave number. The agent on each
   * server pulls and runs these once claimable (see claimJobsForServer).
   * Returns the number created.
   */
  private async createJobs(
    dep: any,
    channel: any,
    waves: string[][],
    branchOverride: string | undefined,
    customCommands: string[],
  ): Promise<number> {
    const repos = await this.pool.query(
      `SELECT rr.repository_id, rr.commit_sha, rr.branch_name, rp.slug, rp.product_id
         FROM release_repositories rr
         JOIN repositories rp ON rp.id = rr.repository_id
        WHERE rr.release_id = $1`,
      [dep.release_id],
    );
    if (repos.rows.length === 0) return 0; // nothing pinned -> caller keeps legacy path

    // Resolve each pinned repo's env vars/secrets once (channel + that repo's
    // product; product-specific overrides channel-global) — depends on
    // neither server nor wave, so no point re-resolving per server.
    const envVarsByRepo = new Map<string, string[]>();
    for (const repo of repos.rows) {
      envVarsByRepo.set(repo.repository_id, await this.environment.resolveForDeploy(channel.id, repo.product_id));
    }

    // On-server environment directory. Override per server via tags.env_path.
    const defaultEnvPath = `oms-${channel.key}`;
    let count = 0;
    for (let wave = 0; wave < waves.length; wave++) {
      for (const serverId of waves[wave]) {
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
                branch, commit_sha, custom_commands, status, wave, env_vars)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
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
              wave + 1,
              JSON.stringify(envVarsByRepo.get(repo.repository_id) || []),
            ],
          );
          count++;
        }
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
             AND j2.wave <= d.current_wave
           ORDER BY j2.created_at
           LIMIT $2
        )
        RETURNING id, deployment_id, repo_slug, env_key, env_path,
                  branch, commit_sha, custom_commands, env_vars`,
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

  /**
   * Settle a deployment once its CURRENT WAVE's jobs have all finished —
   * not all jobs across every wave, since later waves haven't started yet.
   * A wave failure fails the whole deployment and cancels any not-yet-started
   * later-wave jobs; a wave success either advances (rolling), pauses in
   * `awaiting_promotion` for a manual promote (canary), or — on the last
   * wave — settles the deployment as succeeded.
   */
  private async settleDeployment(deploymentId: string) {
    const dep = await this.getRaw(deploymentId);
    if (TERMINAL_STATUSES.includes(dep.status)) return; // already settled (or cancelled)

    const { rows } = await this.pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status IN ('pending','claimed','running'))::int AS open,
         count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM deploy_jobs WHERE deployment_id = $1 AND wave = $2`,
      [deploymentId, dep.current_wave],
    );
    const { total, open, failed } = rows[0];
    if (total === 0 || open > 0) return; // current wave still running

    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [dep.channel_id]);
    const channelKey = ch.rows[0]?.key;

    if (failed > 0) {
      await this.pool.query(
        `UPDATE deployments SET status = 'failed', finished_at = now() WHERE id = $1`,
        [deploymentId],
      );
      // Later-wave jobs never started — skip them so agents don't pick them up.
      await this.pool.query(
        `UPDATE deploy_jobs SET status = 'cancelled', finished_at = now()
          WHERE deployment_id = $1 AND wave > $2 AND status IN ('pending','claimed','running')`,
        [deploymentId, dep.current_wave],
      );
      await this.recordHistory(
        deploymentId, dep.status, 'failed', undefined,
        `wave ${dep.current_wave}/${dep.total_waves} failed`,
      );
      this.rt.emitReleaseEvent('deployment.failed', { id: deploymentId, channel_key: channelKey });
      this.notifications
        .notifyEvent('deployment.failed', {
          title: `Deployment failed — ${dep.current_version} → ${channelKey}`,
          lines: [
            `Release *${dep.current_version}* to *${channelKey}*: wave ${dep.current_wave}/${dep.total_waves} failed.`,
            `${total} agent job(s) in this wave, ${failed} failed.`,
          ],
          severity: 'critical',
        })
        .catch(() => undefined);
      return;
    }

    if (dep.current_wave < dep.total_waves) {
      if (dep.strategy === 'canary') {
        await this.pool.query(`UPDATE deployments SET status = 'awaiting_promotion' WHERE id = $1`, [deploymentId]);
        await this.recordHistory(
          deploymentId, dep.status, 'awaiting_promotion', undefined,
          `wave ${dep.current_wave}/${dep.total_waves} succeeded — awaiting promotion`,
        );
        this.rt.emitReleaseEvent('deployment.awaiting_promotion', {
          id: deploymentId, channel_key: channelKey, wave: dep.current_wave, total_waves: dep.total_waves,
        });
        this.notifications
          .notifyEvent('deployment.awaiting_promotion', {
            title: `Canary wave succeeded — awaiting promotion`,
            lines: [
              `Release *${dep.current_version}* wave ${dep.current_wave}/${dep.total_waves} to *${channelKey}* succeeded.`,
              `Promote to deploy the remaining server(s).`,
            ],
            severity: 'info',
          })
          .catch(() => undefined);
        return;
      }
      // rolling (or any multi-wave strategy without a manual gate): auto-advance.
      await this.pool.query(`UPDATE deployments SET current_wave = current_wave + 1 WHERE id = $1`, [deploymentId]);
      await this.recordHistory(
        deploymentId, dep.status, dep.status, undefined,
        `wave ${dep.current_wave}/${dep.total_waves} succeeded — advancing to wave ${dep.current_wave + 1}`,
      );
      this.rt.emitReleaseEvent('deployment.wave_advanced', {
        id: deploymentId, channel_key: channelKey, wave: dep.current_wave + 1, total_waves: dep.total_waves,
      });
      return;
    }

    // Last (or only) wave succeeded.
    await this.pool.query(
      `UPDATE deployments SET status = 'succeeded', finished_at = now() WHERE id = $1`,
      [deploymentId],
    );
    await this.recordHistory(deploymentId, dep.status, 'succeeded', undefined, 'all waves settled');
    this.rt.emitReleaseEvent('deployment.succeeded', { id: deploymentId, channel_key: channelKey });
    this.notifications
      .notifyEvent('deployment.successful', {
        title: `Deployment succeeded — ${dep.current_version} → ${channelKey}`,
        lines: [`Release *${dep.current_version}* to *${channelKey}*: succeeded.`],
        severity: 'success',
      })
      .catch(() => undefined);
  }

  /** Manually advance a canary past its paused wave to the rest of the servers. */
  async promoteWave(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (dep.status !== 'awaiting_promotion') {
      throw new BadRequestException(`Only deployments awaiting promotion can be promoted (is "${dep.status}")`);
    }
    await this.pool.query(
      `UPDATE deployments SET status = 'in_progress', current_wave = current_wave + 1 WHERE id = $1`,
      [deploymentId],
    );
    await this.recordHistory(
      deploymentId, 'awaiting_promotion', 'in_progress', userId,
      `promoted to wave ${dep.current_wave + 1}/${dep.total_waves}`,
    );
    const ch = await this.pool.query(`SELECT key FROM channels WHERE id = $1`, [dep.channel_id]);
    this.rt.emitReleaseEvent('deployment.wave_advanced', {
      id: deploymentId, channel_key: ch.rows[0]?.key, wave: dep.current_wave + 1, total_waves: dep.total_waves,
    });
    return this.getRaw(deploymentId);
  }

  /** Jobs for a deployment (UI). */
  listJobs(deploymentId: string) {
    return this.pool
      .query(
        `SELECT j.id, j.repo_slug, j.env_key, j.env_path, j.branch, j.commit_sha,
                j.status, j.steps, j.error, j.started_at, j.finished_at, j.wave,
                s.name AS server_name
           FROM deploy_jobs j
           JOIN servers s ON s.id = j.server_id
          WHERE j.deployment_id = $1
          ORDER BY j.wave, s.name, j.repo_slug`,
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

  /**
   * Re-run only the jobs that didn't succeed on a failed deployment's CURRENT
   * wave (no new deployment row). Later-wave jobs a wave failure deliberately
   * cancelled stay cancelled — retry resumes the wave that failed, it doesn't
   * resume the rest of a multi-wave rollout; a fresh deploy does that.
   */
  async retry(deploymentId: string, userId?: string) {
    const dep = await this.getRaw(deploymentId);
    if (dep.status !== 'failed') {
      throw new BadRequestException(`Only failed deployments can be retried (is "${dep.status}")`);
    }
    await this.assertChannelFree(dep.channel_id, deploymentId);
    const failedJobs = await this.pool.query(
      `SELECT server_id, repository_id, repo_slug, env_key, env_path, branch, commit_sha, custom_commands, wave, env_vars
         FROM deploy_jobs WHERE deployment_id = $1 AND wave = $2 AND status NOT IN ('succeeded','cancelled')`,
      [deploymentId, dep.current_wave],
    );
    if (failedJobs.rows.length === 0) {
      throw new BadRequestException('No failed jobs to retry on this deployment');
    }
    for (const j of failedJobs.rows) {
      await this.pool.query(
        `INSERT INTO deploy_jobs
           (deployment_id, server_id, repository_id, repo_slug, env_key, env_path,
            branch, commit_sha, custom_commands, status, wave, env_vars)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
        [
          deploymentId, j.server_id, j.repository_id, j.repo_slug, j.env_key, j.env_path,
          j.branch, j.commit_sha, JSON.stringify(j.custom_commands ?? []), j.wave,
          JSON.stringify(j.env_vars ?? []),
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
        WHERE channel_id = $1 AND status IN ('pending','approved','in_progress','scheduled','awaiting_promotion')
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
