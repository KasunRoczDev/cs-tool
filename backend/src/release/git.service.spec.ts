import { GitService } from './git.service';

describe('GitService.getCheckRuns', () => {
  const OLD_FETCH = global.fetch;
  afterEach(() => { global.fetch = OLD_FETCH; });

  it('maps GitHub check-runs into a flat list, hitting the commit-scoped endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        check_runs: [
          { name: 'unit-tests', status: 'completed', conclusion: 'success', html_url: 'https://x/1', started_at: 'a', completed_at: 'b' },
          { name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://x/2', started_at: 'a', completed_at: 'b' },
        ],
      }),
    }) as any;
    const svc = new GitService();
    const checks = await svc.getCheckRuns({ slug: 'app', remote_url: 'https://github.com/acme/app' }, 'tok', 'abc123');

    expect(checks).toHaveLength(2);
    expect(checks[1]).toMatchObject({ name: 'lint', conclusion: 'failure' });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/repos/acme/app/commits/abc123/check-runs');
  });

  it('returns an empty array when GitHub reports no check runs', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ check_runs: [] }) }) as any;
    const svc = new GitService();
    const checks = await svc.getCheckRuns({ slug: 'app', remote_url: 'https://github.com/acme/app' }, 'tok', 'abc123');
    expect(checks).toEqual([]);
  });

  it('throws a friendly error on a non-2xx GitHub response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad credentials' }) as any;
    const svc = new GitService();
    await expect(
      svc.getCheckRuns({ slug: 'app', remote_url: 'https://github.com/acme/app' }, 'badtoken', 'abc123'),
    ).rejects.toThrow('check the repo token');
  });
});
