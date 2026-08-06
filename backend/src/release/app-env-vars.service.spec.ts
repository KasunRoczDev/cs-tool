import { AppEnvVarsService } from './app-env-vars.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new AppEnvVarsService(pool);
  return { svc, query };
}

const OLD_ENV = process.env;
beforeEach(() => { process.env = { ...OLD_ENV, TOKEN_ENC_KEY: 'test-key-for-encryption' }; });
afterAll(() => { process.env = OLD_ENV; });

describe('AppEnvVarsService.listEnvVars', () => {
  it('masks secret values but passes through plain ones', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [
        { id: 'v1', app_id: 'a1', channel_id: null, key: 'API_URL', is_secret: false, value_plain: 'https://x', has_value: true, channel_name: null, updated_at: null },
        { id: 'v2', app_id: 'a1', channel_id: 'ch1', key: 'API_KEY', is_secret: true, value_plain: null, has_value: true, channel_name: 'Production', updated_at: null },
      ],
    });
    const result = await svc.listEnvVars('a1');
    expect(result[0]).toMatchObject({ key: 'API_URL', value: 'https://x', has_value: true });
    expect(result[1]).toMatchObject({ key: 'API_KEY', value: null, has_value: true, channel_name: 'Production' });
  });

  it('filters to only channel-less rows when channelId is "none"', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listEnvVars('a1', 'none');
    expect(query.mock.calls[0][0]).toContain('aev.channel_id IS NULL');
    expect(query.mock.calls[0][1]).toEqual(['a1']);
  });

  it('filters to a specific channel when a channel id is given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listEnvVars('a1', 'ch1');
    expect(query.mock.calls[0][1]).toEqual(['a1', 'ch1']);
  });
});

describe('AppEnvVarsService.upsertEnvVar', () => {
  it('rejects a missing key or value', async () => {
    const { svc, query } = makeService();
    await expect(svc.upsertEnvVar('a1', { key: '', value: 'x' })).rejects.toThrow('key is required');
    await expect(svc.upsertEnvVar('a1', { key: 'K', value: '' })).rejects.toThrow('value is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts a new plain var when none exists yet', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    const result = await svc.upsertEnvVar('a1', { key: 'API_URL', value: 'https://x' });
    expect(result.id).toBe('v1');
    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO app_env_vars');
  });

  it('encrypts the value when is_secret is true', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await svc.upsertEnvVar('a1', { key: 'API_KEY', value: 'super-secret', is_secret: true });
    const insertCall = query.mock.calls[1];
    const [, , , valueEnc, valuePlain, isSecret] = insertCall[1];
    expect(isSecret).toBe(true);
    expect(valuePlain).toBeNull();
    expect(valueEnc).not.toBe('super-secret');
    expect(valueEnc).toContain(':'); // iv:tag:ciphertext format
  });

  it('updates in place when a matching (app, channel, key) row already exists, using IS NOT DISTINCT FROM for the channel-less case', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await svc.upsertEnvVar('a1', { key: 'API_URL', value: 'https://y' });
    const existsCall = query.mock.calls[0];
    expect(existsCall[0]).toContain('IS NOT DISTINCT FROM');
    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE app_env_vars');
  });
});

describe('AppEnvVarsService.deleteEnvVar', () => {
  it('throws NotFoundException when nothing was deleted', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(svc.deleteEnvVar('a1', 'v1')).rejects.toThrow('not found');
  });
});
