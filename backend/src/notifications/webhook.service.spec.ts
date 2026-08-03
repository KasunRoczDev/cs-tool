import { WebhookService } from './webhook.service';

describe('WebhookService.sendEvent', () => {
  const OLD_FETCH = global.fetch;
  afterEach(() => { global.fetch = OLD_FETCH; });

  it('rejects when no URL is configured', async () => {
    const svc = new WebhookService();
    await expect(svc.sendEvent('', { title: 't', lines: [] })).rejects.toThrow('No webhook_url configured');
  });

  it('POSTs a JSON payload with event/title/lines/severity', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
    const svc = new WebhookService();
    await svc.sendEvent('https://example.com/hook', { title: 'Deploy failed', lines: ['a', 'b'], severity: 'critical', event: 'deployment.failed' });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hook', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ event: 'deployment.failed', title: 'Deploy failed', lines: ['a', 'b'], severity: 'critical' });
  });

  it('throws with the response status on a non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom' }) as any;
    const svc = new WebhookService();
    await expect(svc.sendEvent('https://example.com/hook', { title: 't', lines: [] })).rejects.toThrow('500');
  });
});
