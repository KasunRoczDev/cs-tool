import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createHmac } from 'crypto';
import { PG_POOL } from '../database/database.module';

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Monitoring Platform';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `http://${RP_ID}:5173`;

// A fake but deterministic credential ID for emails with no real passkeys, so
// authenticationOptions() returns an indistinguishable response either way —
// same shape, same size, and stable across repeated calls for the same email
// (a randomly-regenerated decoy would itself leak "this account has no real
// credential" by changing every call, unlike a real stored credential ID).
function decoyCredentialId(email: string): string {
  const secret = process.env.JWT_SECRET ?? 'dev-secret';
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('base64url').slice(0, 32);
}

export interface PasskeyRow {
  id: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

@Injectable()
export class PasskeyService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async registrationOptions(userId: string, email: string) {
    const { rows: existing } = await this.pool.query(
      `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
      [userId],
    );
    return generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: email,
      attestationType: 'none',
      excludeCredentials: existing.map((c: any) => ({
        id: c.credential_id,
        transports: c.transports ?? undefined,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
  }

  async verifyRegistration(userId: string, expectedChallenge: string, response: any) {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Passkey registration could not be verified');
    }
    const { credentialID, credentialPublicKey, counter, credentialDeviceType } =
      verification.registrationInfo;
    await this.pool.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, counter, device_type, transports, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        credentialID,
        Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
        credentialDeviceType,
        response.response?.transports ?? null,
        `Passkey (${new Date().toISOString().slice(0, 10)})`,
      ],
    );
  }

  async authenticationOptions(email: string): Promise<{ options: any; userId?: string }> {
    const { rows: userRows } = await this.pool.query('SELECT id FROM users WHERE email=$1', [email]);
    const userId = userRows[0]?.id;
    let allowCredentials: { id: string; transports?: any }[] = [];
    if (userId) {
      const { rows } = await this.pool.query(
        `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
        [userId],
      );
      allowCredentials = rows.map((c: any) => ({ id: c.credential_id, transports: c.transports ?? undefined }));
    }
    if (allowCredentials.length === 0) {
      // Unknown email or known email with no registered passkeys: substitute
      // a deterministic decoy credential so the response is indistinguishable
      // (same shape, same size) from an account that does have passkeys,
      // preventing enumeration of which emails have passkeys registered.
      allowCredentials = [{ id: decoyCredentialId(email) }];
    }
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred',
      allowCredentials,
    });
    return { options, userId };
  }

  async verifyAuthentication(
    expectedChallenge: string,
    response: any,
  ): Promise<{ id: string; email: string; role: string }> {
    const { rows } = await this.pool.query(
      `SELECT wc.id as cred_row_id, wc.user_id, wc.public_key, wc.counter,
              u.id, u.email, u.role
       FROM webauthn_credentials wc
       JOIN users u ON u.id = wc.user_id
       WHERE wc.credential_id = $1`,
      [response.id],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Unknown passkey');

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: response.id,
        credentialPublicKey: Buffer.from(row.public_key, 'base64url'),
        counter: Number(row.counter),
      },
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Passkey sign-in could not be verified');
    }
    await this.pool.query(
      `UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE credential_id = $2`,
      [verification.authenticationInfo.newCounter, response.id],
    );
    return { id: row.user_id, email: row.email, role: row.role };
  }

  async list(userId: string): Promise<PasskeyRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, label, created_at, last_used_at FROM webauthn_credentials
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}
