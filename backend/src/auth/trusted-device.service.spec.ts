import { TrustedDeviceService } from './trusted-device.service';

function makePool(query: jest.Mock) {
  return { query } as any;
}

describe('TrustedDeviceService', () => {
  it('labelFromUserAgent identifies common browser/OS combos', () => {
    const svc = new TrustedDeviceService(makePool(jest.fn()));
    expect(svc.labelFromUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    )).toBe('Chrome on Windows');
    expect(svc.labelFromUserAgent(undefined)).toBe('Unknown device');
  });

  it('issue() stores a sha256 hash of the token, never the raw token', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new TrustedDeviceService(makePool(query));
    const { token, expiresAt } = await svc.issue('user-1', 'Chrome', '127.0.0.1');
    expect(token).toHaveLength(64); // 32 bytes hex
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const params = query.mock.calls[0][1];
    expect(params[1]).not.toBe(token);
    expect(params[1]).toHaveLength(64); // sha256 hex
  });

  it('verify() returns false for a missing token without querying', async () => {
    const query = jest.fn();
    const svc = new TrustedDeviceService(makePool(query));
    expect(await svc.verify('user-1', undefined)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('verify() returns true only when the update matched a row', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'row-1' }] });
    const svc = new TrustedDeviceService(makePool(query));
    expect(await svc.verify('user-1', 'sometoken')).toBe(true);
  });

  it('list() flags the row matching currentTokenHash as is_current', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'd1', is_current: true }] });
    const svc = new TrustedDeviceService(makePool(query));
    const rows = await svc.list('user-1', 'hash-abc');
    expect(query.mock.calls[0][1]).toEqual(['user-1', 'hash-abc']);
    expect(rows[0].is_current).toBe(true);
  });

  it('revoke() reports whether the revoked row was the current device', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ was_current: true }] });
    const svc = new TrustedDeviceService(makePool(query));
    const result = await svc.revoke('user-1', 'device-1', 'hash-of-current');
    expect(result).toEqual({ revoked: true, wasCurrent: true });
  });

  it('revoke() reports not-revoked when no row matched', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new TrustedDeviceService(makePool(query));
    const result = await svc.revoke('user-1', 'nonexistent', null);
    expect(result).toEqual({ revoked: false, wasCurrent: false });
  });
});
