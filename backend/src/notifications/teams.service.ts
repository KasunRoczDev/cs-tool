import { Injectable, Logger } from '@nestjs/common';
import { EventMessage } from './slack.service';

/**
 * Microsoft Teams notifications via an Incoming Webhook (Office 365 / Power
 * Automate connector). Posts a MessageCard so the title, colour and body render
 * natively in the channel.
 */
@Injectable()
export class TeamsService {
  private readonly log = new Logger('TeamsService');

  isValidWebhook(url: string | undefined | null): boolean {
    if (!url) return false;
    // Accept the classic webhook.office.com and the newer Power Automate URLs.
    return /^https:\/\/[\w.-]*(office\.com|logic\.azure\.com|powerautomate\.com)\//i.test(url);
  }

  private themeColor(sev?: string): string {
    return { critical: 'D7263D', warning: 'F6A609', success: '2EB67D', info: '2F81F7' }[
      sev ?? 'info'
    ]!;
  }

  private async post(webhookUrl: string, payload: Record<string, any>): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Teams webhook returned ${res.status} ${res.statusText} ${body}`.trim());
    }
  }

  async sendEvent(webhookUrl: string, msg: EventMessage): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) throw new Error('Invalid Microsoft Teams webhook URL');
    await this.post(webhookUrl, {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: msg.title,
      themeColor: this.themeColor(msg.severity),
      title: msg.title,
      text: msg.lines.join('\n\n'),
    });
    this.log.log(`Teams event posted — ${msg.title}`);
  }

  async sendTest(webhookUrl: string): Promise<void> {
    if (!this.isValidWebhook(webhookUrl)) {
      throw new Error('Invalid Microsoft Teams webhook URL — paste the full Incoming Webhook URL');
    }
    await this.post(webhookUrl, {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'Test message',
      themeColor: this.themeColor('success'),
      title: '✅ Release & DevOps platform',
      text: 'Your Microsoft Teams channel is configured correctly.',
    });
    this.log.log('Teams test message posted');
  }
}
