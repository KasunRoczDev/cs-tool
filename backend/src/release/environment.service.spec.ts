import { EnvironmentService } from './environment.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new EnvironmentService(pool);
  return { svc, query };
}

const OLD_ENV = process.env;
beforeEach(() => { process.env = { ...OLD_ENV, TOKEN_ENC_KEY: 'test-key-for-encryption' }; });
afterAll(() => { process.env = OLD_ENV; });

describe('EnvironmentService.listEnvVars', () => {
  it('masks secret values but passes through plain ones', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [
        { id: 'v1', channel_id: 'ch1', product_id: null, key: 'API_URL', is_secret: false, value_plain: 'https://x', has_value: true, product_name: null, updated_at: null },
        { id: 'v2', channel_id: 'ch1', product_id: null, key: 'API_KEY', is_secret: true, value_plain: null, has_value: true, product_name: null, updated_at: null },
      ],
    });
    const result = await svc.listEnvVars('ch1');
    expect(result[0]).toMatchObject({ key: 'API_URL', value: 'https://x', has_value: true });
    expect(result[1]).toMatchObject({ key: 'API_KEY', value: null, has_value: true });
  });
});

describe('EnvironmentService.upsertEnvVar', () => {
  it('rejects a missing key or value', async () => {
    const { svc, query } = makeService();
    await expect(svc.upsertEnvVar('ch1', { key: '', value: 'x' })).rejects.toThrow('key is required');
    await expect(svc.upsertEnvVar('ch1', { key: 'K', value: '' })).rejects.toThrow('value is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts a new plain var when none exists yet', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] }); // existing check (none found)
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] }); // INSERT
    const result = await svc.upsertEnvVar('ch1', { key: 'API_URL', value: 'https://x' });
    expect(result.id).toBe('v1');
    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO channel_env_vars');
  });

  it('encrypts the value when is_secret is true', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await svc.upsertEnvVar('ch1', { key: 'API_KEY', value: 'super-secret', is_secret: true });
    const insertCall = query.mock.calls[1];
    const [, , , valueEnc, valuePlain, isSecret] = insertCall[1];
    expect(isSecret).toBe(true);
    expect(valuePlain).toBeNull();
    expect(valueEnc).not.toBe('super-secret'); // encrypted, not stored raw
    expect(valueEnc).toContain(':'); // iv:tag:ciphertext format
  });

  it('updates in place when a matching (channel, product, key) row already exists', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] }); // existing found
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] }); // UPDATE
    await svc.upsertEnvVar('ch1', { key: 'API_URL', value: 'https://y' });
    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE channel_env_vars');
  });
});

describe('EnvironmentService.deleteEnvVar', () => {
  it('throws NotFoundException when nothing was deleted', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(svc.deleteEnvVar('ch1', 'v1')).rejects.toThrow('not found');
  });
});

describe('EnvironmentService.resolveForDeploy', () => {
  it('lets a product-specific value override a global one with the same key, and decrypts secrets', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [
        { key: 'DEBUG', value_enc: null, value_plain: 'false', is_secret: false, product_id: null },
        { key: 'DEBUG', value_enc: null, value_plain: 'true', is_secret: false, product_id: 'p1' },
        { key: 'DB_PASS', value_enc: require('../common/crypto.util').encryptSecret('hunter2'), value_plain: null, is_secret: true, product_id: null },
      ],
    });
    const result = await svc.resolveForDeploy('ch1', 'p1');
    expect(result).toContain('DEBUG=true'); // product override wins
    expect(result).toContain('DB_PASS=hunter2'); // decrypted
  });
});

describe('EnvironmentService.compareChannels', () => {
  it('flags keys present on only one side and reports equality for keys on both', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ key: 'A', value_plain: '1', value_enc: null, is_secret: false, product_id: null }] });
    query.mockResolvedValueOnce({
      rows: [
        { key: 'A', value_plain: '1', value_enc: null, is_secret: false, product_id: null },
        { key: 'B', value_plain: '2', value_enc: null, is_secret: false, product_id: null },
      ],
    });
    const diff = await svc.compareChannels('ch1', 'ch2');
    const a = diff.find((d) => d.key === 'A');
    const b = diff.find((d) => d.key === 'B');
    expect(a).toMatchObject({ in_a: true, in_b: true, equal: true });
    expect(b).toMatchObject({ in_a: false, in_b: true, equal: null });
  });
});

describe('EnvironmentService.lockChannel / unlockChannel', () => {
  it('throws NotFoundException locking a channel that does not exist', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.lockChannel('bogus', 'reason', 'u1')).rejects.toThrow('Channel not found');
  });

  it('locks with a reason and actor', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', locked: true, locked_reason: 'freeze' }] });
    const result = await svc.lockChannel('ch1', 'freeze', 'u1');
    expect(result.locked).toBe(true);
  });

  it('unlocks and clears the reason', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', locked: false, locked_reason: null }] });
    const result = await svc.unlockChannel('ch1');
    expect(result.locked).toBe(false);
  });
});
