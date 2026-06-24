import { Injectable, Logger } from '@nestjs/common';

export interface AlertDiscordContext {
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

/** Discord embed colours (decimal) keyed by severity. */
const SEVERITY_COLORS: Record<string, number> = {
  low: 0x38a169,      // green
  medium: 0xd69e2e,   // amber
  high: 0xdd6b20,     // orange
  critical: 0xe53e3e, // red
};

@Injectable()
export class DiscordService {
  private readonly log = new Logger('DiscordService');

  /** Basic sanity check that a webhook URL looks like a Discord webhook. */
  isValidWebhook(url: string | undefined | null): boolean {
    if (!url) return false;
    return /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i.test(url);
  }

  /** Low-level POST to a Discord webhook. Throws on non-2xx. */
  private async post(webhookUrl: string, payload: Record<string, any>): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord webhook returned ${res.status} ${res.statusText} ${body}`.trim());
    }
  }

  async sendAlert(
    webhookUrl: string,
    username: string | undefined,
    ctx: AlertDiscordContext,
  ): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) {
      throw new Error('Invalid Discord webhook URL');
    }

    const resolved = ctx.event === 'resolve';
    const title = resolved
      ? `✅ Resolved: ${ctx.alertType} on ${ctx.serverName}`
      : `🔴 Alert: ${ctx.alertType} on ${ctx.serverName}`;
    const color = resolved ? 0x38a169 : (SEVERITY_COLORS[ctx.severity] ?? 0x808080);

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: 'Server', value: ctx.serverName || '—', inline: true },
      { name: 'Severity', value: (ctx.severity || 'unknown').toUpperCase(), inline: true },
      { name: 'Status', value: resolved ? 'RESOLVED' : 'OPEN', inline: true },
    ];

    if (ctx.value != null) {
      const threshold = ctx.threshold != null ? ` (threshold ${ctx.threshold.toFixed(0)})` : '';
      fields.push({ name: 'Value', value: `${ctx.value.toFixed(1)}${threshold}`, inline: true });
    }

    fields.push({ name: 'Message', value: ctx.message || '—', inline: false });

    await this.post(webhookUrl, {
      username: username || 'Server Monitor',
      embeds: [
        {
          title,
          color,
          fields,
          footer: { text: 'Cybersecurity & Server Metrics Monitoring Platform' },
          timestamp: ctx.timestamp.toISOString(),
        },
      ],
    });

    this.log.log(`Discord alert posted — ${title}`);
  }

  async sendTest(webhookUrl: string, username?: string): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) {
      throw new Error('Invalid Discord webhook URL — paste the full webhook from Discord → Channel Settings → Integrations');
    }
    await this.post(webhookUrl, {
      username: username || 'Server Monitor',
      embeds: [
        {
          title: '✅ Test notification',
          description:
            'This is a test message from the **Cybersecurity & Server Metrics Monitoring Platform**. ' +
            'Your Discord channel is correctly configured and will receive alerts.',
          color: 0x38a169,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    this.log.log('Discord test message posted');
  }
}
