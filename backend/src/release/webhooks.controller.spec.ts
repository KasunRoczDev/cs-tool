import { createHmac } from 'crypto';
import { WebhooksController } from './webhooks.controller';

describe('WebhooksController.github', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV, GITHUB_WEBHOOK_SECRET: 'testsecret' }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('accepts a signature computed over the raw body even when JSON.stringify(body) would not reproduce it', async () => {
    const notifications = { notifyEvent: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new WebhooksController(notifications);

    // Pretty-printed, like a real provider payload might arrive formatted —
    // JSON.stringify(JSON.parse(raw)) is compact and would NOT byte-match this,
    // which is exactly what made the old JSON.stringify(body)-based check fragile.
    const raw = Buffer.from(JSON.stringify({
      action: 'opened',
      pull_request: { number: 42, title: 'Add thing', user: { login: 'dev' }, html_url: 'https://x/42' },
      repository: { full_name: 'org/repo' },
    }, null, 2));
    const body = JSON.parse(raw.toString());
    const sig = 'sha256=' + createHmac('sha256', 'testsecret').update(raw).digest('hex');

    expect(JSON.stringify(body)).not.toEqual(raw.toString()); // sanity: the two representations really do differ

    const result = await controller.github(
      { 'x-hub-signature-256': sig, 'x-github-event': 'pull_request' } as any,
      body,
      { rawBody: raw } as any,
    );
    expect(result).toEqual({ accepted: true, event: 'pr.created' });
    expect(notifications.notifyEvent).toHaveBeenCalledWith('pr.created', expect.any(Object));
  });

  it('fails closed when req.rawBody was not captured, instead of falling back to JSON.stringify(body)', async () => {
    const notifications = { notifyEvent: jest.fn() } as any;
    const controller = new WebhooksController(notifications);
    const body = { action: 'opened', pull_request: {}, repository: {} };
    const sig = 'sha256=' + createHmac('sha256', 'testsecret').update(JSON.stringify(body)).digest('hex');

    const result = await controller.github(
      { 'x-hub-signature-256': sig, 'x-github-event': 'pull_request' } as any,
      body,
      {} as any,
    );
    expect(result).toEqual({ accepted: false, reason: 'invalid_signature' });
    expect(notifications.notifyEvent).not.toHaveBeenCalled();
  });

  it('rejects a signature that does not match the raw body', async () => {
    const notifications = { notifyEvent: jest.fn() } as any;
    const controller = new WebhooksController(notifications);
    const raw = Buffer.from(JSON.stringify({ action: 'opened' }));

    const result = await controller.github(
      { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), 'x-github-event': 'pull_request' } as any,
      { action: 'opened' },
      { rawBody: raw } as any,
    );
    expect(result).toEqual({ accepted: false, reason: 'invalid_signature' });
  });

  it('accepts unsigned requests when no secret is configured', async () => {
    delete (process.env as any).GITHUB_WEBHOOK_SECRET;
    const notifications = { notifyEvent: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new WebhooksController(notifications);

    const result = await controller.github(
      { 'x-github-event': 'pull_request' } as any,
      { action: 'opened', pull_request: { number: 1, title: 't', user: {} }, repository: {} },
      {} as any,
    );
    expect(result).toEqual({ accepted: true, event: 'pr.created' });
  });
});
