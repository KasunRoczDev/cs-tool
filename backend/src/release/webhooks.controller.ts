import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Provider webhook ingress. GitHub pull_request events are normalized to the
 * platform events `pr.created` / `pr.merged` and fanned out to subscribed
 * notification channels. Public (no JWT) but HMAC-verified when a secret is set.
 *
 * Configure GitHub → repo → Settings → Webhooks:
 *   Payload URL: https://<host>/api/v1/webhooks/github
 *   Content-Type: application/json
 *   Secret: value of GITHUB_WEBHOOK_SECRET
 *   Events: Pull requests
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('github')
  @HttpCode(202)
  async github(
    @Headers() headers: Record<string, string>,
    @Body() body: any,
  ): Promise<{ accepted: boolean; event?: string; reason?: string }> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (secret) {
      const sig = headers['x-hub-signature-256'];
      const expected =
        'sha256=' + createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
      const ok =
        !!sig &&
        sig.length === expected.length &&
        timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) return { accepted: false, reason: 'invalid_signature' };
    }

    if (headers['x-github-event'] !== 'pull_request') {
      return { accepted: true, reason: 'ignored' };
    }

    const pr = body.pull_request ?? {};
    const repo = body.repository?.full_name ?? 'repository';
    const who = pr.user?.login ?? body.sender?.login ?? 'someone';
    const link = pr.html_url ?? '';

    if (body.action === 'opened') {
      await this.notifications.notifyEvent('pr.created', {
        title: `PR #${pr.number} opened in ${repo}`,
        lines: [`*${pr.title}*`, `by ${who}`, link],
        severity: 'info',
      });
      return { accepted: true, event: 'pr.created' };
    }
    if (body.action === 'closed' && pr.merged) {
      await this.notifications.notifyEvent('pr.merged', {
        title: `PR #${pr.number} merged in ${repo}`,
        lines: [`*${pr.title}*`, `into ${pr.base?.ref ?? 'base'} by ${who}`, link],
        severity: 'success',
      });
      return { accepted: true, event: 'pr.merged' };
    }
    return { accepted: true, reason: 'ignored_action' };
  }
}
