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

describe('AgentReleasesService.bucketFor', () => {
  it('is deterministic for the same server id', () => {
    const a = AgentReleasesService.bucketFor('server-123');
    const b = AgentReleasesService.bucketFor('server-123');
    expect(a).toBe(b);
  });

  it('returns a value between 0 and 99', () => {
    const b = AgentReleasesService.bucketFor('any-id');
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it('spreads different server ids across buckets (not all identical)', () => {
    const buckets = new Set(
      Array.from({ length: 50 }, (_, i) => AgentReleasesService.bucketFor(`server-${i}`)),
    );
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('AgentReleasesService.latestFor', () => {
  it('is not eligible when the server is individually excluded', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: true }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
    expect(query).toHaveBeenCalledTimes(1); // short-circuits before checking the kill switch
  });

  it('is not eligible when the global kill switch is off', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] }); // server lookup
    query.mockResolvedValueOnce({ rows: [{ value: 'false' }] }); // platform_settings
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is not eligible when there is no active release', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [] }); // no active release
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is not eligible when the server falls outside the rollout percent bucket', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [{ version: '2.0.0', sha256: 'a', signature: 'b', rollout_percent: 0 }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is eligible when everything lines up (rollout_percent 100 always matches)', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [{ version: '2.0.0', sha256: 'a', signature: 'b', rollout_percent: 100 }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: true, version: '2.0.0', sha256: 'a', signature: 'b' });
  });
});

describe('AgentReleasesService.getPackage', () => {
  it('throws NotFoundException for an unknown or inactive version', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.getPackage('9.9.9')).rejects.toThrow('not found');
  });

  it('returns the package bytes for an active version', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ package: Buffer.from('deb-bytes') }] });
    const result = await svc.getPackage('1.2.0');
    expect(result).toEqual(Buffer.from('deb-bytes'));
    expect(query.mock.calls[0][0]).toContain('is_active = true');
  });
});

describe('AgentReleasesService.reportUpdate', () => {
  it('writes the reported status onto the server row', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    const result = await svc.reportUpdate('s1', { version: '2.0.0', status: 'succeeded' });
    expect(result).toEqual({ ok: true });
    const call = query.mock.calls[0];
    expect(call[0]).toContain('UPDATE servers');
    expect(call[1]).toEqual(['s1', '2.0.0', 'succeeded', null]);
  });
});
