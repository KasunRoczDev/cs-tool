import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { EmailService, AlertEmailContext } from './email.service';
import { CreateChannelDto, UpdateChannelDto, CreateRuleDto, UpdateRuleDto } from './dto';

export interface AlertPayload {
  id: string;
  server_id: string;
  server_name: string;
  type: string;
  severity: string;
  threshold: number | null;
  value: number | null;
  message: string;
  status: 'open' | 'resolved';
  created_at: Date;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly email: EmailService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────────

  async listChannels() {
    const { rows } = await this.pool.query(
      `SELECT nc.*, u.email AS created_by_email,
              count(nr.id)::int AS rule_count
         FROM notification_channels nc
         LEFT JOIN users u ON u.id = nc.created_by
         LEFT JOIN notification_rules nr ON nr.channel_id = nc.id
        GROUP BY nc.id, u.email
        ORDER BY nc.created_at DESC`,
    );
    return rows;
  }

  async createChannel(dto: CreateChannelDto, userId: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO notification_channels (name, type, config, enabled, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [dto.name, dto.type, JSON.stringify(dto.config), dto.enabled ?? true, userId],
    );
    return rows[0];
  }

  async updateChannel(id: string, dto: UpdateChannelDto) {
    const sets: string[] = ['updated_at = now()'];
    const params: any[] = [];
    if (dto.name !== undefined)    { params.push(dto.name);                    sets.push(`name = $${params.length}`); }
    if (dto.config !== undefined)  { params.push(JSON.stringify(dto.config));  sets.push(`config = $${params.length}`); }
    if (dto.enabled !== undefined) { params.push(dto.enabled);                 sets.push(`enabled = $${params.length}`); }
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE notification_channels SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Channel not found');
    return rows[0];
  }

  async deleteChannel(id: string) {
    await this.pool.query('DELETE FROM notification_channels WHERE id = $1', [id]);
    return { deleted: id };
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  async listRules(channelId?: string) {
    const where = channelId ? 'WHERE nr.channel_id = $1' : '';
    const params = channelId ? [channelId] : [];
    const { rows } = await this.pool.query(
      `SELECT nr.*, nc.name AS channel_name, s.name AS server_name
         FROM notification_rules nr
         LEFT JOIN notification_channels nc ON nc.id = nr.channel_id
         LEFT JOIN servers s ON s.id = nr.server_id
        ${where}
        ORDER BY nr.created_at DESC`,
      params,
    );
    return rows;
  }

  async createRule(dto: CreateRuleDto) {
    const { rows } = await this.pool.query(
      `INSERT INTO notification_rules
         (channel_id, server_id, alert_type, severities, on_open, on_resolve, cooldown_minutes, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        dto.channel_id,
        dto.server_id ?? null,
        dto.alert_type ?? null,
        dto.severities ?? ['low', 'medium', 'high', 'critical'],
        dto.on_open ?? true,
        dto.on_resolve ?? false,
        dto.cooldown_minutes ?? 30,
        dto.enabled ?? true,
      ],
    );
    return rows[0];
  }

  async updateRule(id: string, dto: UpdateRuleDto) {
    const sets: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if ('server_id' in dto)        set('server_id', dto.server_id ?? null);
    if ('alert_type' in dto)       set('alert_type', dto.alert_type ?? null);
    if (dto.severities !== undefined) set('severities', dto.severities);
    if (dto.on_open !== undefined)    set('on_open', dto.on_open);
    if (dto.on_resolve !== undefined) set('on_resolve', dto.on_resolve);
    if (dto.cooldown_minutes !== undefined) set('cooldown_minutes', dto.cooldown_minutes);
    if (dto.enabled !== undefined) set('enabled', dto.enabled);
    if (sets.length === 0) return this.listRules().then((r) => r.find((x) => x.id === id));
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE notification_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Rule not found');
    return rows[0];
  }

  async deleteRule(id: string) {
    await this.pool.query('DELETE FROM notification_rules WHERE id = $1', [id]);
    return { deleted: id };
  }

  // ── Test ────────────────────────────────────────────────────────────────

  async testChannel(channelId: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM notification_channels WHERE id = $1', [channelId],
    );
    const ch = rows[0];
    if (!ch) throw new NotFoundException('Channel not found');
    const to = ch.config?.to;
    if (!to) throw new Error('Channel has no "to" email configured');
    await this.email.sendTest(to);
    return { sent: true, to };
  }

  // ── Notification log ─────────────────────────────────────────────────────

  async listLog(limit = 100) {
    const { rows } = await this.pool.query(
      `SELECT nl.*, nc.name AS channel_name, s.name AS server_name
         FROM notification_log nl
         LEFT JOIN notification_channels nc ON nc.id = nl.channel_id
         LEFT JOIN servers s ON s.id = nl.server_id
        ORDER BY nl.sent_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  // ── Core dispatch (called by AlertEngineService) ─────────────────────────

  /**
   * Find all enabled rules that match this alert and fire notifications.
   * event = 'open'    → fires rules with on_open = true
   * event = 'resolve' → fires rules with on_resolve = true
   */
  async dispatch(alert: AlertPayload, event: 'open' | 'resolve') {
    if (!(await this.email.isConfigured())) return;

    // Load matching rules in one query.
    const { rows: rules } = await this.pool.query(
      `SELECT nr.*, nc.config, nc.type, nc.enabled AS channel_enabled
         FROM notification_rules nr
         JOIN notification_channels nc ON nc.id = nr.channel_id
        WHERE nr.enabled = TRUE
          AND nc.enabled = TRUE
          AND ($1 = TRUE  AND nr.on_open    = TRUE  OR  $2 = TRUE AND nr.on_resolve = TRUE)
          AND ($3::text = ANY(nr.severities))
          AND (nr.server_id IS NULL OR nr.server_id = $4)
          AND (nr.alert_type IS NULL OR nr.alert_type = $5)`,
      [event === 'open', event === 'resolve', alert.severity, alert.server_id, alert.type],
    );

    for (const rule of rules) {
      await this.fireRule(rule, alert, event);
    }
  }

  private async fireRule(rule: any, alert: AlertPayload, event: 'open' | 'resolve') {
    // Cool-down check: skip if we already notified this rule+alert within cooldown window.
    if (rule.cooldown_minutes > 0) {
      const { rows } = await this.pool.query(
        `SELECT 1 FROM notification_log
          WHERE rule_id = $1 AND alert_id = $2 AND status = 'sent'
            AND sent_at > now() - ($3 || ' minutes')::interval
          LIMIT 1`,
        [rule.id, alert.id, rule.cooldown_minutes],
      );
      if (rows.length > 0) {
        this.log.debug(`Cool-down active for rule ${rule.id} / alert ${alert.id}`);
        await this.logEntry(rule, alert, event, 'suppressed', null);
        return;
      }
    }

    try {
      if (rule.type === 'email') {
        const cfg = rule.config ?? {};
        const to: string = cfg.to;
        if (!to) { this.log.warn(`Rule ${rule.id}: channel has no "to" address`); return; }
        const ctx: AlertEmailContext = {
          alertId: alert.id,
          serverName: alert.server_name,
          alertType: alert.type,
          severity: alert.severity,
          message: alert.message,
          value: alert.value,
          threshold: alert.threshold,
          event,
          timestamp: new Date(),
        };
        await this.email.sendAlert(to, cfg.cc, cfg.subject_prefix ?? '[Monitor Alert]', ctx);
      }
      await this.logEntry(rule, alert, event, 'sent', null);
    } catch (err: any) {
      this.log.error(`Notification failed rule ${rule.id}: ${err.message}`);
      await this.logEntry(rule, alert, event, 'failed', err.message);
    }
  }

  private async logEntry(
    rule: any,
    alert: AlertPayload,
    event: string,
    status: string,
    error: string | null,
  ) {
    await this.pool.query(
      `INSERT INTO notification_log
         (rule_id, channel_id, alert_id, server_id, alert_type, event, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rule.id, rule.channel_id, alert.id, alert.server_id, alert.type, event, status, error],
    ).catch((e) => this.log.warn(`Failed to write notification log: ${e.message}`));
  }
}
