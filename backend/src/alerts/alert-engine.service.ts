import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

interface MetricSample {
  cpu_usage?: number;
  memory_usage?: number;
  disk_usage?: number;
}

interface SecurityEvent {
  event_type: string;
  severity?: string;
  message?: string;
  raw?: Record<string, unknown> | null;
}

/**
 * PHP-FPM security-event types that should be promoted to real alerts.
 * Emitted by the agent's fpm collector (see agent/src/collectors/fpm.js).
 * Note: per-pool alerts dedup on (server_id, type); the pool name is in the message.
 */
const FPM_ALERT_TYPES = new Set([
  'fpm_max_children_reached',
  'fpm_pool_saturated',
  'fpm_listen_queue_backlog',
  'fpm_slow_requests',
  'fpm_hot_worker',
  'fpm_unreachable',
]);

@Injectable()
export class AlertEngineService {
  private readonly log = new Logger('AlertEngine');

  private readonly cpu = num('ALERT_CPU_THRESHOLD', 90);
  private readonly mem = num('ALERT_MEM_THRESHOLD', 90);
  private readonly disk = num('ALERT_DISK_THRESHOLD', 90);
  private readonly offlineSec = num('ALERT_OFFLINE_SECONDS', 120);
  private readonly bruteCount = num('ALERT_SSH_BRUTEFORCE_COUNT', 5);
  private readonly bruteWindow = num('ALERT_SSH_BRUTEFORCE_WINDOW_SEC', 60);
  // FPM alerts are edge-triggered: the agent re-emits them each cycle while
  // unhealthy and stops once recovered. Auto-resolve when none seen for this long.
  private readonly fpmStaleSec = num('ALERT_FPM_STALE_SECONDS', 300);

  // Service / application metric thresholds (from service_metrics_snapshot).
  // "Higher is worse" metrics:
  private readonly svcApiP95Ms      = num('ALERT_API_P95_MS', 3000);
  private readonly svcApiErrorRate  = num('ALERT_API_ERROR_RATE', 5);          // %
  private readonly svcPgConnPct     = num('ALERT_PG_CONNECTIONS_PCT', 90);     // % of max_connections
  private readonly svcPgSlowQueries = num('ALERT_PG_SLOW_QUERIES', 10);
  private readonly svcRedisMemPct   = num('ALERT_REDIS_MEMORY_PCT', 90);       // %
  private readonly svcBullPending   = num('ALERT_BULLMQ_PENDING', 5000);
  private readonly svcBullFailed    = num('ALERT_BULLMQ_FAILED', 25);
  private readonly svcDockerRestarts = num('ALERT_DOCKER_RESTARTS', 5);
  private readonly svcSshFailed     = num('ALERT_FAILED_SSH_ATTEMPTS', 25);
  private readonly svcLoadPerCore   = num('ALERT_LOAD_PER_CORE', 2);
  // "Lower is worse" metrics:
  private readonly svcSslExpiryDays = num('ALERT_SSL_EXPIRY_DAYS', 7);
  private readonly svcOrderSuccess  = num('ALERT_ORDER_SUCCESS_RATE', 95);     // %

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly rt: RealtimeGateway,
    private readonly notif: NotificationsService,
  ) {}

  /** Evaluate resource thresholds against a freshly ingested metric sample. */
  async evaluateMetric(serverId: string, m: MetricSample) {
    await this.check(serverId, 'cpu_high', m.cpu_usage, this.cpu, 'high',
      (v) => `CPU at ${v?.toFixed(1)}%`);
    await this.check(serverId, 'mem_high', m.memory_usage, this.mem, 'high',
      (v) => `Memory at ${v?.toFixed(1)}%`);
    await this.check(serverId, 'disk_full', m.disk_usage, this.disk, 'critical',
      (v) => `Disk at ${v?.toFixed(1)}%`);
  }

  /** Route an ingested security event to the matching alert logic. */
  async evaluateSecurityEvent(serverId: string, e: SecurityEvent) {
    if (e.event_type === 'ssh_failed_login') {
      await this.evaluateSecurity(serverId, e.event_type);
    } else if (e.event_type === 'service_metrics_snapshot') {
      await this.evaluateServiceMetrics(serverId, e.raw);
    } else if (FPM_ALERT_TYPES.has(e.event_type)) {
      await this.raise(
        serverId,
        e.event_type,
        e.severity ?? 'medium',
        null,
        null,
        e.message ?? e.event_type,
      );
    }
  }

  /**
   * Promote breached service/application metrics to first-class alerts.
   * Each metric dedups on (server_id, type) and auto-resolves once it recovers,
   * so this is safe to call on every snapshot the agent ships.
   */
  async evaluateServiceMetrics(serverId: string, raw: Record<string, any> | null | undefined) {
    if (!raw || typeof raw !== 'object') return;
    const n = (v: any) => (typeof v === 'number' && isFinite(v) ? v : undefined);

    await this.check(serverId, 'api_p95_high', n(raw.api_p95_ms), this.svcApiP95Ms, 'high',
      (v) => `API p95 latency ${Math.round(v ?? 0)}ms`);
    await this.check(serverId, 'api_error_rate_high', n(raw.api_error_rate), this.svcApiErrorRate, 'high',
      (v) => `API error rate ${v?.toFixed(2)}%`);
    await this.check(serverId, 'pg_connections_high', n(raw.pg_connections_pct), this.svcPgConnPct, 'high',
      (v) => `PostgreSQL connections at ${v?.toFixed(0)}% of max`);
    await this.check(serverId, 'pg_slow_queries', n(raw.pg_slow_queries), this.svcPgSlowQueries, 'medium',
      (v) => `${v} slow PostgreSQL queries`);
    await this.check(serverId, 'redis_memory_high', n(raw.redis_memory_pct), this.svcRedisMemPct, 'high',
      (v) => `Redis memory at ${v?.toFixed(0)}%`);
    await this.check(serverId, 'bullmq_pending_high', n(raw.bullmq_pending), this.svcBullPending, 'medium',
      (v) => `${v} BullMQ jobs pending`);
    await this.check(serverId, 'bullmq_failed_high', n(raw.bullmq_failed), this.svcBullFailed, 'high',
      (v) => `${v} BullMQ jobs failed`);
    await this.check(serverId, 'docker_restarts_high', n(raw.docker_restart_count), this.svcDockerRestarts, 'medium',
      (v) => `Docker restart count ${v}`);
    await this.check(serverId, 'ssh_failed_attempts_high', n(raw.failed_ssh_attempts), this.svcSshFailed, 'high',
      (v) => `${v} failed SSH attempts`);
    await this.check(serverId, 'load_high', n(raw.load_per_core), this.svcLoadPerCore, 'medium',
      (v) => `Load ${v?.toFixed(2)}x per core`);

    await this.checkLow(serverId, 'ssl_expiry_soon', n(raw.ssl_expiry_days), this.svcSslExpiryDays, 'critical',
      (v) => `TLS certificate expires in ${v} day(s)`);
    await this.checkLow(serverId, 'order_success_low', n(raw.order_success_rate), this.svcOrderSuccess, 'high',
      (v) => `Order success rate ${v?.toFixed(1)}%`);
  }

  /** Detect SSH brute-force from recent failed logins. */
  async evaluateSecurity(serverId: string, eventType: string) {
    if (eventType !== 'ssh_failed_login') return;
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS c FROM security_events
        WHERE server_id = $1 AND event_type = 'ssh_failed_login'
          AND time > now() - ($2 || ' seconds')::interval`,
      [serverId, this.bruteWindow],
    );
    if (rows[0].c >= this.bruteCount) {
      await this.raise(serverId, 'ssh_bruteforce', 'critical', this.bruteCount,
        rows[0].c, `SSH brute-force: ${rows[0].c} failed logins in ${this.bruteWindow}s`);
    } else {
      // Fix: auto-resolve brute-force alert when attack subsides
      await this.autoResolve(serverId, 'ssh_bruteforce');
    }
  }

  /** Periodically flag servers that stopped reporting. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkOffline() {
    const { rows } = await this.pool.query(
      `UPDATE servers SET status = 'offline'
         WHERE status <> 'offline'
           AND last_seen IS NOT NULL
           AND last_seen < now() - ($1 || ' seconds')::interval
       RETURNING id, name`,
      [this.offlineSec],
    );
    for (const s of rows) {
      await this.raise(s.id, 'offline', 'high', this.offlineSec, null,
        `Server ${s.name} is offline`);
      this.rt.emitServerStatus({ serverId: s.id, status: 'offline' });
    }
  }

  /**
   * Auto-resolve FPM alerts that have gone quiet. FPM events are re-emitted
   * each agent cycle while the condition holds; once the agent stops sending a
   * given type, the alert is considered recovered after fpmStaleSec.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async resolveStaleFpmAlerts() {
    const { rows } = await this.pool.query(
      `SELECT a.server_id, a.type
         FROM alerts a
        WHERE a.status = 'open'
          AND a.type = ANY($1)
          AND NOT EXISTS (
            SELECT 1 FROM security_events se
             WHERE se.server_id = a.server_id
               AND se.event_type = a.type
               AND se.time > now() - ($2 || ' seconds')::interval
          )`,
      [Array.from(FPM_ALERT_TYPES), this.fpmStaleSec],
    );
    for (const r of rows) {
      await this.autoResolve(r.server_id, r.type);
    }
  }

  private async check(
    serverId: string,
    type: string,
    value: number | undefined,
    threshold: number,
    severity: string,
    msg: (v?: number) => string,
  ) {
    if (value == null) return;
    if (value >= threshold) {
      await this.raise(serverId, type, severity, threshold, value, msg(value));
    } else {
      await this.autoResolve(serverId, type);
    }
  }

  /** Like check(), but for "lower is worse" metrics (e.g. cert days, success rate). */
  private async checkLow(
    serverId: string,
    type: string,
    value: number | undefined,
    threshold: number,
    severity: string,
    msg: (v?: number) => string,
  ) {
    if (value == null) return;
    if (value <= threshold) {
      await this.raise(serverId, type, severity, threshold, value, msg(value));
    } else {
      await this.autoResolve(serverId, type);
    }
  }

  /** Upsert an open alert (dedup via partial unique index), broadcast, and notify. */
  private async raise(
    serverId: string,
    type: string,
    severity: string,
    threshold: number | null,
    value: number | null,
    message: string,
  ) {
    // Fetch server name for notifications
    const { rows: srvRows } = await this.pool.query(
      'SELECT name FROM servers WHERE id = $1', [serverId],
    );
    const serverName = srvRows[0]?.name ?? serverId;

    const { rows } = await this.pool.query(
      `INSERT INTO alerts (server_id, type, severity, threshold, value, message)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (server_id, type) WHERE status = 'open'
       DO UPDATE SET value = EXCLUDED.value, message = EXCLUDED.message
       RETURNING *, (xmax = 0) AS is_new`,
      [serverId, type, severity, threshold, value, message],
    );
    if (rows[0]) {
      this.rt.emitAlert(rows[0]);
      this.log.warn(`ALERT ${type} :: ${message}`);

      // Only dispatch notification on a genuinely new alert (not just value update)
      if (rows[0].is_new) {
        this.notif.dispatch(
          {
            id: rows[0].id,
            server_id: serverId,
            server_name: serverName,
            type,
            severity,
            threshold,
            value,
            message,
            status: 'open',
            created_at: rows[0].created_at,
          },
          'open',
        ).catch((e) => this.log.error(`Notification dispatch failed: ${e.message}`));
      }
    }
  }

  private async autoResolve(serverId: string, type: string) {
    const { rows: srvRows } = await this.pool.query(
      'SELECT name FROM servers WHERE id = $1', [serverId],
    );
    const serverName = srvRows[0]?.name ?? serverId;

    const { rows } = await this.pool.query(
      `UPDATE alerts SET status='resolved', resolved_at=now()
        WHERE server_id=$1 AND type=$2 AND status='open'
       RETURNING *`,
      [serverId, type],
    );
    if (rows[0]) {
      this.rt.emitAlert({ id: rows[0].id, status: 'resolved' });

      this.notif.dispatch(
        {
          id: rows[0].id,
          server_id: serverId,
          server_name: serverName,
          type,
          severity: rows[0].severity,
          threshold: rows[0].threshold,
          value: rows[0].value,
          message: rows[0].message,
          status: 'resolved',
          created_at: rows[0].created_at,
        },
        'resolve',
      ).catch((e) => this.log.error(`Notification dispatch failed: ${e.message}`));
    }
  }
}

function num(key: string, def: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : def;
}
