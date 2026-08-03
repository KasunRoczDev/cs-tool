import { AgentReleasesService } from './agent-releases.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new AgentReleasesService(pool);
  return { svc, query };
}

describe('AgentReleasesService.publish', () => {
  it('rejects a version that does not look like semver', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: 'not-a-version', package: Buffer.from('x'), signature: 'sig' }),
    ).rejects.toThrow('version must look like');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing package buffer', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: '1.2.0', package: Buffer.alloc(0), signature: 'sig' }),
    ).rejects.toThrow('package file is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing signature', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: '1.2.0', package: Buffer.from('x'), signature: '' }),
    ).rejects.toThrow('signature is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('computes the sha256 server-side and inserts the release', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ id: 'r1', version: '1.2.0', changelog: null, sha256: 'abc', rollout_percent: 0, is_active: true, created_at: 'now' }],
    });
    const result = await svc.publish({ version: '1.2.0', package: Buffer.from('hello'), signature: 'sig' });
    expect(result.id).toBe('r1');
    const insertCall = query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO agent_releases');
    const [version, changelog, pkg, sha256, signature] = insertCall[1];
    expect(version).toBe('1.2.0');
    expect(changelog).toBeNull();
    expect(pkg).toEqual(Buffer.from('hello'));
    // sha256('hello') is a well-known digest
    expect(sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(signature).toBe('sig');
  });
});

describe('AgentReleasesService.list', () => {
  it('returns all releases newest first', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r2' }, { id: 'r1' }] });
    const result = await svc.list();
    expect(result).toEqual([{ id: 'r2' }, { id: 'r1' }]);
    expect(query.mock.calls[0][0]).toContain('ORDER BY created_at DESC');
  });
});

describe('AgentReleasesService.updateRollout', () => {
  it('rejects an out-of-range rollout_percent', async () => {
    const { svc, query } = makeService();
    await expect(svc.updateRollout('r1', { rollout_percent: 150 })).rejects.toThrow('between 0 and 100');
    expect(query).not.toHaveBeenCalled();
  });

  it('updates rollout_percent and is_active together', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', rollout_percent: 50, is_active: false }] });
    const result = await svc.updateRollout('r1', { rollout_percent: 50, is_active: false });
    expect(result).toEqual({ id: 'r1', rollout_percent: 50, is_active: false });
    expect(query.mock.calls[0][0]).toContain('UPDATE agent_releases');
  });

  it('throws NotFoundException when the release does not exist', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.updateRollout('bogus', { is_active: false })).rejects.toThrow('not found');
  });
});
