import { Injectable, Logger } from '@nestjs/common';

/** Generic platform-event context shared by the chat senders. */
export interface EventMessage {
  title: string;
  lines: string[];
  severity?: 'info' | 'success' | 'warning' | 'critical';
}

/**
 * Slack notifications via an Incoming Webhook URL
 * (https://hooks.slack.com/services/...). Posts mrkdwn-formatted messages.
 */
@Injectable()
export class SlackService {
  private readonly log = new Logger('SlackService');

  isValidWebhook(url: string | undefined | null): boolean {
    if (!url) return false;
    return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/.test(url);
  }

  private async post(webhookUrl: string, payload: Record<string, any>): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Slack webhook returned ${res.status} ${res.statusText} ${body}`.trim());
    }
  }

  async sendEvent(webhookUrl: string, msg: EventMessage): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) throw new Error('Invalid Slack webhook URL');
    const emoji = { critical: '🔴', warning: '🟠', success: '✅', info: '🔔' }[msg.severity ?? 'info'];
    const text = `${emoji} *${msg.title}*\n${msg.lines.join('\n')}`;
    await this.post(webhookUrl, { text });
    this.log.log(`Slack event posted — ${msg.title}`);
  }

  async sendTest(webhookUrl: string): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) {
      throw new Error('Invalid Slack webhook URL — paste the full Incoming Webhook from Slack');
    }
    await this.post(webhookUrl, {
      text: '✅ *Release & DevOps platform* — Slack channel configured correctly.',
    });
    this.log.log('Slack test message posted');
  }
}
