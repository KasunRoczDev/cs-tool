import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

export interface AlertEmailContext {
  alertId: string;
  serverName: string;
  alertType: string;
  severity: string;
  message: string;
  value?: number | null;
  threshold?: number | null;
  event: 'open' | 'resolve';
  timestamp: Date;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger('EmailService');

  constructor(private readonly settings: SettingsService) {}

  /** Build a transporter from current DB settings (+ env-var fallbacks). */
  private async makeTransporter() {
    const cfg = await this.settings.getSmtpConfig();
    if (!cfg.smtp_host) return null;
    return {
      transporter: nodemailer.createTransport({
        host: cfg.smtp_host,
        port: Number(cfg.smtp_port) || 587,
        secure: cfg.smtp_secure === 'true',
        auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
      }),
      from: cfg.smtp_from || cfg.smtp_user || 'monitor@example.com',
    };
  }

  async isConfigured(): Promise<boolean> {
    const cfg = await this.settings.getSmtpConfig();
    return !!cfg.smtp_host;
  }

  async sendAlert(
    to: string,
    cc: string | undefined,
    subjectPrefix: string,
    ctx: AlertEmailContext,
  ): Promise<void> {
    const conn = await this.makeTransporter();
    if (!conn) throw new Error('SMTP not configured');

    const action = ctx.event === 'open' ? '🔴 ALERT' : '✅ RESOLVED';
    const subject = `${subjectPrefix} ${action}: ${ctx.alertType} on ${ctx.serverName}`;

    const metricLine =
      ctx.value != null
        ? `<tr><td><b>Value</b></td><td>${ctx.value?.toFixed(1)} (threshold: ${ctx.threshold?.toFixed(0)})</td></tr>`
        : '';

    const statusColor = ctx.event === 'open' ? '#e53e3e' : '#38a169';
    const severityColors: Record<string, string> = {
      low: '#38a169', medium: '#d69e2e', high: '#dd6b20', critical: '#e53e3e',
    };
    const sevColor = severityColors[ctx.severity] ?? '#888';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f7f7f7; margin:0; padding: 20px; }
  .card { background: #fff; border-radius: 8px; max-width: 560px; margin: 0 auto;
          border: 1px solid #e2e8f0; overflow: hidden; }
  .header { background: ${statusColor}; color: #fff; padding: 18px 24px; }
  .header h1 { margin: 0; font-size: 18px; }
  .header p  { margin: 4px 0 0; opacity: 0.85; font-size: 13px; }
  .body { padding: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  td:first-child { color: #666; width: 130px; }
  .sev { display: inline-block; padding: 2px 10px; border-radius: 12px;
         font-size: 12px; font-weight: bold;
         background: ${sevColor}22; color: ${sevColor}; border: 1px solid ${sevColor}66; }
  .footer { padding: 12px 24px; background: #f7f7f7; font-size: 11px; color: #999;
            border-top: 1px solid #e2e8f0; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>${ctx.event === 'open' ? '🔴 Alert Triggered' : '✅ Alert Resolved'}: ${ctx.alertType}</h1>
    <p>${ctx.timestamp.toUTCString()}</p>
  </div>
  <div class="body">
    <table>
      <tr><td><b>Server</b></td><td>${ctx.serverName}</td></tr>
      <tr><td><b>Alert type</b></td><td>${ctx.alertType}</td></tr>
      <tr><td><b>Severity</b></td><td><span class="sev">${ctx.severity}</span></td></tr>
      ${metricLine}
      <tr><td><b>Message</b></td><td>${ctx.message}</td></tr>
      <tr><td><b>Status</b></td><td>${ctx.event === 'open' ? 'OPEN' : 'RESOLVED'}</td></tr>
    </table>
  </div>
  <div class="footer">Sent by Cybersecurity &amp; Server Metrics Monitoring Platform</div>
</div>
</body>
</html>`;

    await conn.transporter.sendMail({ from: conn.from, to, cc, subject, html });
    this.log.log(`Email sent to ${to} — ${subject}`);
  }

  async sendTest(to: string): Promise<void> {
    const conn = await this.makeTransporter();
    if (!conn) throw new Error('SMTP not configured — set SMTP settings in Settings page first');
    await conn.transporter.sendMail({
      from: conn.from,
      to,
      subject: '[Monitor] Test notification — SMTP is working',
      html: `<p>This is a test email from the <b>Cybersecurity &amp; Server Metrics Monitoring Platform</b>.</p>
             <p>SMTP is correctly configured. You will receive alerts at this address.</p>`,
    });
  }
}
