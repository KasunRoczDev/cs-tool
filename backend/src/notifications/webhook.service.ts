import { Injectable, Logger } from '@nestjs/common';
import { EventMessage } from './slack.service';

/**
 * Generic outbound webhook channel — POSTs a plain JSON payload to any URL,
 * with no provider-specific formatting (unlike the Slack/Discord/Teams
 * senders). Lets a channel subscribe to platform events without the
 * receiving end being one of those three specific providers.
 */
@Injectable()
export class WebhookService {
  private readonly log = new Logger('WebhookService');

  async sendEvent(url: string, msg: EventMessage & { event?: string }): Promise<void> {
    if (!url) throw new Error('No webhook_url configured');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: msg.event ?? null,
        title: msg.title,
        lines: msg.lines,
        severity: msg.severity ?? 'info',
        sent_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Webhook returned ${res.status} ${res.statusText} ${body}`.trim());
    }
    this.log.log(`Webhook event posted — ${msg.title}`);
  }

  async sendTest(url: string): Promise<void> {
    await this.sendEvent(url, {
      title: 'Test notification',
      lines: ['Release & DevOps platform — webhook configured correctly.'],
      severity: 'info',
    });
  }
}
