jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'reg-challenge' }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockImplementation((opts: any) =>
    Promise.resolve({ challenge: 'auth-challenge', allowCredentials: opts.allowCredentials }),
  ),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { PasskeyService } from './passkey.service';

function makePool(query: jest.Mock) {
  return { query } as any;
}

describe('PasskeyService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores a new credential after a verified registration', async () => {
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credentialID: 'cred-1',
        credentialPublicKey: Buffer.from('pubkey'),
        counter: 0,
        credentialDeviceType: 'singleDevice',
      },
    });
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new PasskeyService(makePool(query));

    await svc.verifyRegistration('user-1', 'reg-challenge', { response: { transports: ['internal'] } } as any);

    const insertCall = query.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO webauthn_credentials'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('user-1');
    expect(insertCall[1][1]).toBe('cred-1');
  });

  it('rejects an unverified registration response', async () => {
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({ verified: false });
    const svc = new PasskeyService(makePool(jest.fn().mockResolvedValue({ rows: [] })));
    await expect(
      svc.verifyRegistration('user-1', 'reg-challenge', { response: {} } as any),
    ).rejects.toThrow('could not be verified');
  });

  it('rejects authentication against an unknown credential', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new PasskeyService(makePool(query));
    await expect(
      svc.verifyAuthentication('auth-challenge', { id: 'unknown-cred' }),
    ).rejects.toThrow('Unknown passkey');
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('bumps the counter and returns the owning user after a verified authentication', async () => {
    const credRow = {
      cred_row_id: 'row-1', user_id: 'user-1',
      public_key: Buffer.from('pubkey').toString('base64url'),
      counter: '3', id: 'user-1', email: 'a@b.com', role: 'admin',
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [credRow] })
      .mockResolvedValueOnce({ rows: [] });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 4 },
    });
    const svc = new PasskeyService(makePool(query));

    const user = await svc.verifyAuthentication('auth-challenge', { id: 'cred-1' });

    expect(user).toEqual({ id: 'user-1', email: 'a@b.com', role: 'admin' });
    const updateCall = query.mock.calls[1];
    expect(updateCall[1]).toEqual([4, 'cred-1']);
  });

  it('returns a non-empty decoy allowCredentials for an email with no real passkeys', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] }); // no user found
    const svc = new PasskeyService(makePool(query));
    const { options } = await svc.authenticationOptions('nobody@example.com');
    expect(options.allowCredentials.length).toBeGreaterThan(0);
  });

  it('gives the decoy credential a non-empty transports array, matching the shape of a real entry', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] }); // no user found
    const svc = new PasskeyService(makePool(query));
    const { options } = await svc.authenticationOptions('nobody@example.com');
    expect(Array.isArray(options.allowCredentials[0].transports)).toBe(true);
    expect(options.allowCredentials[0].transports.length).toBeGreaterThan(0);
  });

  it('returns a decoy allowCredentials entry for a known email with zero registered passkeys', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // user exists
      .mockResolvedValueOnce({ rows: [] }); // but has no webauthn_credentials rows
    const svc = new PasskeyService(makePool(query));
    const { options, userId } = await svc.authenticationOptions('has-account@example.com');
    expect(userId).toBe('user-1');
    expect(options.allowCredentials.length).toBeGreaterThan(0);
    expect(Array.isArray(options.allowCredentials[0].transports)).toBe(true);
    expect(options.allowCredentials[0].transports.length).toBeGreaterThan(0);
  });

  it('returns the SAME decoy id for the same email across repeated calls', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new PasskeyService(makePool(query));
    const first = await svc.authenticationOptions('same@example.com');
    const second = await svc.authenticationOptions('same@example.com');
    expect(first.options.allowCredentials[0].id).toBe(second.options.allowCredentials[0].id);
  });

  it('returns different decoy ids for different emails', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new PasskeyService(makePool(query));
    const a = await svc.authenticationOptions('a@example.com');
    const b = await svc.authenticationOptions('b@example.com');
    expect(a.options.allowCredentials[0].id).not.toBe(b.options.allowCredentials[0].id);
  });
});
