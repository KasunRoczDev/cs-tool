import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { TrustedDeviceService } from './trusted-device.service';

// Accept the previous/next 30s step too, to tolerate clock drift between
// the server and the user's phone.
authenticator.options = { window: 1 };

const ISSUER = process.env.MFA_ISSUER || 'Monitoring Platform';
// Short-lived token that ONLY proves the password step; it cannot access the API.
const MFA_TOKEN_TTL = process.env.MFA_TOKEN_TTL || '10m';
// Short-lived token carrying a WebAuthn challenge between the options and verify calls.
const CHALLENGE_TTL = '5m';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
    private readonly trustedDevices: TrustedDeviceService,
  ) {}

  /** Full session token used as the API bearer. */
  private accessToken(user: { id: string; email: string; role: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwt.sign(payload, {
        expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
      }),
      user: payload,
    };
  }

  /** Public wrapper so passwordless passkey login can issue a full session token. */
  issueAccessToken(user: { id: string; email: string; role: string }) {
    return this.accessToken(user);
  }

  /** Step 1 — verify the password. Never returns an access token directly:
   *  MFA is required for all users, so we hand back a partial token plus
   *  either a verify or a setup (QR) challenge — UNLESS the request carries
   *  a cookie for a device this user has already trusted, in which case the
   *  OTP step is skipped and a full access token is returned immediately. */
  async login(email: string, password: string, deviceToken?: string) {
    const { rows } = await this.pool.query(
      'SELECT id, email, password_hash, role, mfa_enabled FROM users WHERE email=$1',
      [email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfa_enabled) {
      if (await this.trustedDevices.verify(user.id, deviceToken)) {
        return this.accessToken(user);
      }
      // Already enrolled → ask for a code.
      const mfa_token = this.jwt.sign(
        { sub: user.id, scope: 'mfa' },
        { expiresIn: MFA_TOKEN_TTL },
      );
      return { mfa_required: true, mfa_token };
    }

    // Not yet enrolled → issue a fresh secret (carried inside the signed setup
    // token so we don't persist it until the user proves they have it) and a QR.
    const secret = authenticator.generateSecret();
    const otpauth_url = authenticator.keyuri(user.email, ISSUER, secret);
    const qr = await QRCode.toDataURL(otpauth_url);
    const mfa_token = this.jwt.sign(
      { sub: user.id, scope: 'mfa_setup', secret },
      { expiresIn: MFA_TOKEN_TTL },
    );
    return { mfa_setup_required: true, mfa_token, otpauth_url, qr, secret };
  }

  /** Step 2a — enrolled user submits a code to finish login. */
  async verifyMfa(mfaToken: string, code: string, trustDevice: boolean, ua?: string, ip?: string) {
    const claims = this.verifyScopedToken(mfaToken, 'mfa');
    const { rows } = await this.pool.query(
      'SELECT id, email, role, mfa_secret FROM users WHERE id=$1',
      [claims.sub],
    );
    const user = rows[0];
    if (!user?.mfa_secret) throw new UnauthorizedException('MFA not configured');
    if (!authenticator.verify({ token: String(code).trim(), secret: user.mfa_secret })) {
      throw new UnauthorizedException('Invalid authentication code');
    }
    return this.finishMfa(user, trustDevice, ua, ip);
  }

  /** Step 2b — first-time user confirms a code, which saves the secret. */
  async enrollMfa(mfaToken: string, code: string, trustDevice: boolean, ua?: string, ip?: string) {
    const claims = this.verifyScopedToken(mfaToken, 'mfa_setup');
    const secret = claims.secret as string;
    if (!secret) throw new UnauthorizedException('Invalid setup token');
    if (!authenticator.verify({ token: String(code).trim(), secret })) {
      throw new UnauthorizedException('Invalid authentication code');
    }
    const { rows } = await this.pool.query(
      `UPDATE users SET mfa_secret=$1, mfa_enabled=true
       WHERE id=$2 RETURNING id, email, role`,
      [secret, claims.sub],
    );
    const user = rows[0];
    if (!user) throw new UnauthorizedException('User not found');
    return this.finishMfa(user, trustDevice, ua, ip);
  }

  /** Shared tail of verifyMfa/enrollMfa: issue the session token, and if the
   *  caller asked to trust this device, mint a device token alongside it. */
  private async finishMfa(
    user: { id: string; email: string; role: string },
    trustDevice: boolean,
    ua?: string,
    ip?: string,
  ) {
    const result: any = this.accessToken(user);
    if (trustDevice) {
      const { token, expiresAt } = await this.trustedDevices.issue(user.id, ua, ip);
      result.device_token = token;
      result.device_expires_at = expiresAt;
    }
    return result;
  }

  /** Sign a short-lived, scope-tagged challenge token (same pattern as the MFA tokens). */
  signChallenge(scope: string, sub: string, challenge: string) {
    return this.jwt.sign({ sub, scope, challenge }, { expiresIn: CHALLENGE_TTL });
  }

  /** Verify a challenge token and return its claims. */
  verifyChallenge(scope: string, token: string, expectedSub?: string) {
    return this.verifyScopedToken(token, scope, expectedSub);
  }

  /** Verify a partial/challenge token, assert its scope (and optionally its subject). */
  private verifyScopedToken(token: string, scope: string, expectedSub?: string) {
    let claims: any;
    try {
      claims = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Session expired, please try again');
    }
    if (claims.scope !== scope) {
      throw new UnauthorizedException('Invalid token');
    }
    if (expectedSub && claims.sub !== expectedSub) {
      throw new UnauthorizedException('Invalid token');
    }
    return claims;
  }
}
