import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
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
    @Req() req: any,
  ): Promise<{ accepted: boolean; event?: string; reason?: string }> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (secret) {
      // Verify against the exact bytes GitHub signed (main.ts stashes them as
      // req.rawBody), not JSON.stringify(body) — re-serializing the parsed
      // object isn't guaranteed to byte-match the original payload, which would
      // silently reject legitimately-signed webhooks. Fail closed if the raw
      // body wasn't captured for some reason, rather than falling back to the
      // broken comparison.
      const raw: Buffer | undefined = req.rawBody;
      const sig = headers['x-hub-signature-256'];
      if (!raw) return { accepted: false, reason: 'invalid_signature' };
      const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
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
