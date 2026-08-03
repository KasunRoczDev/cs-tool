import { ReleasesService } from './releases.service';
import { encryptSecret } from '../common/crypto.util';

// get(id) issues 3 pool.query calls in order: release row, then [repos, items] in parallel.
function mockGet(query: jest.Mock, release: any, repos: any[] = [], items: any[] = []) {
  query.mockResolvedValueOnce({ rows: [release] });
  query.mockResolvedValueOnce({ rows: repos });
  query.mockResolvedValueOnce({ rows: items });
}

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const git = { getCheckRuns: jest.fn() } as any;
  const rt = { emitReleaseEvent: jest.fn() } as any;
  const notifications = { notifyEvent: jest.fn() } as any;
  const status = { nextStatusKey: jest.fn(), transition: jest.fn() } as any;
  const svc = new ReleasesService(pool, git, rt, notifications, status);
  return { svc, query, status, git };
}

describe('ReleasesService.promote', () => {
  it('rejects promoting an archived release', async () => {
    const { svc, query, status } = makeService();
    mockGet(query, { id: 'r1', status: 'archived' });
    await expect(svc.promote('r1', 'u1', 'operator')).rejects.toThrow('cannot be promoted');
    expect(status.nextStatusKey).not.toHaveBeenCalled();
  });

  it('rejects promoting a draft with no pinned repositories', async () => {
    const { svc, query, status } = makeService();
    mockGet(query, { id: 'r1', status: 'draft' }, []);
    await expect(svc.promote('r1', 'u1', 'operator')).rejects.toThrow('no pinned repositories');
    expect(status.nextStatusKey).not.toHaveBeenCalled();
  });

  it('rejects when the resolved workflow has no further forward transition', async () => {
    const { svc, query, status } = makeService();
    mockGet(query, { id: 'r1', status: 'enterprise' }, [{ id: 'rr1' }]);
    status.nextStatusKey.mockResolvedValueOnce(null);
    await expect(svc.promote('r1', 'u1', 'operator')).rejects.toThrow('cannot be promoted further');
  });

  it('delegates to StatusService.transition with the resolved next status and skipPermissionCheck', async () => {
    const { svc, query, status } = makeService();
    mockGet(query, { id: 'r1', status: 'draft' }, [{ id: 'rr1' }]);
    status.nextStatusKey.mockResolvedValueOnce('canary');
    status.transition.mockResolvedValueOnce({ current: { key: 'canary' } });

    const result = await svc.promote('r1', 'u1', 'operator');

    expect(status.transition).toHaveBeenCalledWith('r1', 'u1', 'operator', 'canary', undefined, {
      skipPermissionCheck: true,
    });
    expect(result).toEqual({ current: { key: 'canary' } });
  });
});

describe('ReleasesService.update — planned_date', () => {
  it('sets planned_date when given a valid date', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', planned_date: '2026-09-01' }] });
    const result = await svc.update('r1', { planned_date: '2026-09-01' });
    expect(result.planned_date).toBe('2026-09-01');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('planned_date = $');
    expect(params).toContain('2026-09-01');
  });

  it('clears planned_date when given an empty string', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', planned_date: null }] });
    await svc.update('r1', { planned_date: '' });
    const [, params] = query.mock.calls[0];
    expect(params).toContain(null);
  });

  it('rejects an unparseable planned_date', async () => {
    const { svc, query } = makeService();
    await expect(svc.update('r1', { planned_date: 'not-a-date' })).rejects.toThrow('planned_date must be a valid date');
    expect(query).not.toHaveBeenCalled();
  });

  it('leaves planned_date untouched when not provided', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    await svc.update('r1', { name: 'New name' });
    const [sql] = query.mock.calls[0];
    expect(sql).not.toContain('planned_date');
  });
});

describe('ReleasesService.testStatus', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV, TOKEN_ENC_KEY: 'test-key-for-encryption' }; });
  afterAll(() => { process.env = OLD_ENV; });

  const REPO_LINK = { id: 'rr1', repository_id: 'repo1', repository_name: 'app', commit_sha: 'abc123' };

  it('reports unavailable for a repo with no GitHub token', async () => {
    const { svc, query } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: null }],
    });
    const result = await svc.testStatus('r1');
    expect(result.repositories[0]).toMatchObject({ overall: 'unavailable', reason: expect.stringContaining('token') });
  });

  it('reports passed when every check run succeeded', async () => {
    const { svc, query, git } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: encryptSecret('tok') }],
    });
    git.getCheckRuns.mockResolvedValueOnce([{ name: 'unit', status: 'completed', conclusion: 'success' }]);
    const result = await svc.testStatus('r1');
    expect(result.repositories[0].overall).toBe('passed');
  });

  it('reports failed when any check run failed', async () => {
    const { svc, query, git } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: encryptSecret('tok') }],
    });
    git.getCheckRuns.mockResolvedValueOnce([
      { name: 'unit', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
    ]);
    const result = await svc.testStatus('r1');
    expect(result.repositories[0].overall).toBe('failed');
  });

  it('reports pending while a check run is still in progress', async () => {
    const { svc, query, git } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: encryptSecret('tok') }],
    });
    git.getCheckRuns.mockResolvedValueOnce([{ name: 'unit', status: 'in_progress', conclusion: null }]);
    const result = await svc.testStatus('r1');
    expect(result.repositories[0].overall).toBe('pending');
  });

  it('reports no_checks when GitHub has zero check runs for the commit', async () => {
    const { svc, query, git } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: encryptSecret('tok') }],
    });
    git.getCheckRuns.mockResolvedValueOnce([]);
    const result = await svc.testStatus('r1');
    expect(result.repositories[0].overall).toBe('no_checks');
  });

  it('reports unavailable (not a thrown error) when the GitHub API call fails', async () => {
    const { svc, query, git } = makeService();
    mockGet(query, { id: 'r1' }, [REPO_LINK], []);
    query.mockResolvedValueOnce({
      rows: [{ slug: 'app', provider: 'github', remote_url: 'https://github.com/acme/app', github_token_enc: encryptSecret('tok') }],
    });
    git.getCheckRuns.mockRejectedValueOnce(new Error('GitHub API error 401'));
    const result = await svc.testStatus('r1');
    expect(result.repositories[0]).toMatchObject({ overall: 'unavailable', reason: expect.stringContaining('GitHub') });
  });
});
