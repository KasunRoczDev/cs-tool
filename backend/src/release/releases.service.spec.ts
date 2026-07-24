import { ReleasesService } from './releases.service';

// get(id) issues 3 pool.query calls in order: release row, then [repos, items] in parallel.
function mockGet(query: jest.Mock, release: any, repos: any[] = [], items: any[] = []) {
  query.mockResolvedValueOnce({ rows: [release] });
  query.mockResolvedValueOnce({ rows: repos });
  query.mockResolvedValueOnce({ rows: items });
}

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const git = {} as any;
  const rt = { emitReleaseEvent: jest.fn() } as any;
  const notifications = { notifyEvent: jest.fn() } as any;
  const status = { nextStatusKey: jest.fn(), transition: jest.fn() } as any;
  const svc = new ReleasesService(pool, git, rt, notifications, status);
  return { svc, query, status };
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
