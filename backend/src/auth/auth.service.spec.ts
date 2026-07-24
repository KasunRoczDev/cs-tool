jest.mock('otplib', () => ({
  authenticator: {
    options: {},
    verify: jest.fn().mockReturnValue(true),
    generateSecret: jest.fn(),
    keyuri: jest.fn(),
  },
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

function makeJwt() {
  return {
    sign: jest.fn((payload: any) => `signed:${JSON.stringify(payload)}`),
    verify: jest.fn((token: string) => JSON.parse(token.replace('signed:', ''))),
  } as any;
}

describe('AuthService.login', () => {
  const user = {
    id: 'user-1', email: 'a@b.com', password_hash: 'hash', role: 'admin', mfa_enabled: true,
  };

  it('skips MFA and returns a full access token when the device is trusted', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [user] }) } as any;
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const trustedDevices = { verify: jest.fn().mockResolvedValue(true) } as any;
    const svc = new AuthService(pool, makeJwt(), trustedDevices);

    const result: any = await svc.login('a@b.com', 'password', 'a-trusted-cookie');

    expect(trustedDevices.verify).toHaveBeenCalledWith('user-1', 'a-trusted-cookie');
    expect(result.access_token).toBeDefined();
    expect(result.mfa_required).toBeUndefined();
  });

  it('still requires MFA when there is no matching trusted device', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [user] }) } as any;
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const trustedDevices = { verify: jest.fn().mockResolvedValue(false) } as any;
    const svc = new AuthService(pool, makeJwt(), trustedDevices);

    const result: any = await svc.login('a@b.com', 'password', undefined);

    expect(result.mfa_required).toBe(true);
    expect(result.access_token).toBeUndefined();
  });

  it('rejects an invalid password before ever checking the device', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [user] }) } as any;
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const trustedDevices = { verify: jest.fn() } as any;
    const svc = new AuthService(pool, makeJwt(), trustedDevices);

    await expect(svc.login('a@b.com', 'wrong', 'any-cookie')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(trustedDevices.verify).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyMfa with trust_device', () => {
  it('issues a device token when trustDevice is true', async () => {
    const mfaUser = { id: 'user-1', email: 'a@b.com', role: 'admin', mfa_secret: 'SECRET' };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [mfaUser] }) } as any;
    const trustedDevices = {
      issue: jest.fn().mockResolvedValue({ token: 'raw-device-token', expiresAt: new Date() }),
    } as any;
    const jwt = makeJwt();
    const svc = new AuthService(pool, jwt, trustedDevices);

    const mfaToken = svc.signChallenge('mfa', 'user-1', '');
    const result: any = await svc.verifyMfa(mfaToken, '123456', true, 'Chrome/Windows', '127.0.0.1');

    expect(trustedDevices.issue).toHaveBeenCalledWith('user-1', 'Chrome/Windows', '127.0.0.1');
    expect(result.device_token).toBe('raw-device-token');
    expect(result.access_token).toBeDefined();
  });

  it('does not issue a device token when trustDevice is false', async () => {
    const mfaUser = { id: 'user-1', email: 'a@b.com', role: 'admin', mfa_secret: 'SECRET' };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [mfaUser] }) } as any;
    const trustedDevices = { issue: jest.fn() } as any;
    const jwt = makeJwt();
    const svc = new AuthService(pool, jwt, trustedDevices);

    const mfaToken = svc.signChallenge('mfa', 'user-1', '');
    const result: any = await svc.verifyMfa(mfaToken, '123456', false);

    expect(trustedDevices.issue).not.toHaveBeenCalled();
    expect(result.device_token).toBeUndefined();
  });
});

describe('AuthService challenge tokens', () => {
  it('signChallenge/verifyChallenge round-trip and enforce scope', () => {
    const svc = new AuthService({} as any, makeJwt(), {} as any);
    const token = svc.signChallenge('passkey_reg', 'user-1', 'abc123');
    const claims = svc.verifyChallenge('passkey_reg', token, 'user-1');
    expect(claims.challenge).toBe('abc123');
    expect(() => svc.verifyChallenge('passkey_auth', token)).toThrow(UnauthorizedException);
    expect(() => svc.verifyChallenge('passkey_reg', token, 'someone-else')).toThrow(UnauthorizedException);
  });
});
