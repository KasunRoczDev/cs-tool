# Trusted Devices, 7-Day OTP Skip, and Passwordless Passkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark a browser as trusted (skips the TOTP-code step for 7
days, password still always required), manage that trust from Settings, and
optionally register a passkey for fully passwordless sign-in.

**Architecture:** Two new Postgres tables (`trusted_devices`,
`webauthn_credentials`), two new backend services (`TrustedDeviceService`,
`PasskeyService`) wired into the existing `AuthModule`, new routes on
`AuthController`, and matching additions to the login page and Settings page.
WebAuthn challenge state is carried in short-lived signed JWTs — the same
"state in a scope-tagged token" pattern `auth.service.ts` already uses for
TOTP enrollment — no new session store.

**Tech Stack:** NestJS 10 / `pg` / `@nestjs/jwt` (backend, existing), Next.js
14 (frontend, existing). New: `cookie-parser` + `@simplewebauthn/server`
(backend), `@simplewebauthn/browser` (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-trusted-devices-passkeys-design.md`
- All new tables use `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, matching every existing table.
- All new `.sql` migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and wired into `backend/scripts/migrate.js` + both `docker-compose*.yml` files, following the exact pattern the other 10 migrations already use.
- Only the sha256 hash of the device-trust token is ever persisted — mirrors `hashApiKey()` in `backend/src/common/hash.util.ts`. The raw token lives only in the httpOnly cookie.
- Trusted-device expiry is **fixed** at 7 days from the moment "trust this device" was checked — not rolling/extended by use.
- Passkey login is **email-first** (not resident/usernameless) and is a **passwordless** path — no OTP step, since the WebAuthn ceremony itself is possession+inherence.
- New deps: `cookie-parser@^1.4.7` + `@types/cookie-parser@^1.4.7` (backend), `@simplewebauthn/server@^10.0.1` (backend), `@simplewebauthn/browser@^10.0.0` (dashboard).
- Global `ValidationPipe({ whitelist: true })` (`backend/src/main.ts`) strips any DTO property without a `class-validator` decorator — every new DTO field (including free-form `credential` objects) needs an explicit decorator (e.g. `@IsObject()`) or it silently disappears.

---

### Task 1: Database migrations + docker wiring

**Files:**
- Create: `database/trusted_devices_migration.sql`
- Create: `database/webauthn_migration.sql`
- Modify: `backend/scripts/migrate.js`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

**Interfaces:**
- Produces: tables `trusted_devices(id, user_id, token_hash, label, ip, created_at, last_used_at, expires_at, revoked_at)` and `webauthn_credentials(id, user_id, credential_id, public_key, counter, device_type, transports, label, created_at, last_used_at)`, both referencing `users(id)`.

- [ ] **Step 1: Create `database/trusted_devices_migration.sql`**

```sql
-- Trusted devices: lets a user skip the OTP-code step for 7 days on a
-- browser they've explicitly marked as trusted. Password is still always
-- required — this only ever bypasses the TOTP entry step.
-- Apply: psql "$DATABASE_URL" -f database/trusted_devices_migration.sql

CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
```

- [ ] **Step 2: Create `database/webauthn_migration.sql`**

```sql
-- WebAuthn (passkey) credentials for fully passwordless sign-in.
-- Apply: psql "$DATABASE_URL" -f database/webauthn_migration.sql

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  device_type   TEXT,
  transports    TEXT[],
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
```

- [ ] **Step 3: Wire both into `backend/scripts/migrate.js`**

Insert this block right after the existing RBAC migration block (after the
`RBAC_MIGRATION_PATH` block ends, before `const email = process.env.ADMIN_EMAIL ...`):

```js
  // Apply trusted-devices migration (idempotent — IF NOT EXISTS).
  const trustedDevicesPath =
    process.env.TRUSTED_DEVICES_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/trusted_devices_migration.sql');
  if (fs.existsSync(trustedDevicesPath)) {
    console.log('Applying trusted-devices migration...');
    await client.query(fs.readFileSync(trustedDevicesPath, 'utf8'));
  }

  // Apply WebAuthn (passkeys) migration (idempotent — IF NOT EXISTS).
  const webauthnPath =
    process.env.WEBAUTHN_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/webauthn_migration.sql');
  if (fs.existsSync(webauthnPath)) {
    console.log('Applying webauthn migration...');
    await client.query(fs.readFileSync(webauthnPath, 'utf8'));
  }
```

- [ ] **Step 4: Add env vars + volume mounts to `docker-compose.yml`**

In the `backend.environment` block, after `RBAC_MIGRATION_PATH: /app/database/rbac_migration.sql`:

```yaml
      TRUSTED_DEVICES_MIGRATION_PATH: /app/database/trusted_devices_migration.sql
      WEBAUTHN_MIGRATION_PATH: /app/database/webauthn_migration.sql
      WEBAUTHN_RP_ID: localhost
      WEBAUTHN_RP_NAME: Monitoring Platform
      WEBAUTHN_ORIGIN: http://localhost:5173
```

In the `backend.volumes` block, after the `rbac_migration.sql` mount line:

```yaml
      - ./database/trusted_devices_migration.sql:/app/database/trusted_devices_migration.sql:ro
      - ./database/webauthn_migration.sql:/app/database/webauthn_migration.sql:ro
```

- [ ] **Step 5: Add env vars to `docker-compose.dev.yml`**

In the `backend.environment` block, after `RBAC_MIGRATION_PATH: /database/rbac_migration.sql`:

```yaml
      TRUSTED_DEVICES_MIGRATION_PATH: /database/trusted_devices_migration.sql
      WEBAUTHN_MIGRATION_PATH: /database/webauthn_migration.sql
```

(No volume changes needed here — `docker-compose.dev.yml` already bind-mounts
the whole `./database` folder at `/database`.)

- [ ] **Step 6: Verify the migration SQL is syntactically valid**

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db`
Then: `docker compose exec db psql -U monitor -d monitoring -f /dev/stdin < database/trusted_devices_migration.sql` — wait, the file is on the host, not in the container. Instead, copy it in and run:

```bash
docker cp database/trusted_devices_migration.sql $(docker compose ps -q db):/tmp/t.sql
docker compose exec db psql -U monitor -d monitoring -f /tmp/t.sql
docker cp database/webauthn_migration.sql $(docker compose ps -q db):/tmp/w.sql
docker compose exec db psql -U monitor -d monitoring -f /tmp/w.sql
docker compose exec db psql -U monitor -d monitoring -c "\d trusted_devices" -c "\d webauthn_credentials"
```

Expected: both `\d` calls print the column lists exactly as defined above, no errors. (`users` table must already exist for the FK — schema.sql runs first in the real migrate.js path; running these two files standalone here is just to validate SQL syntax before Task 10's full end-to-end run.)

- [ ] **Step 7: Commit**

```bash
git add database/trusted_devices_migration.sql database/webauthn_migration.sql backend/scripts/migrate.js docker-compose.yml docker-compose.dev.yml
git commit -m "feat(auth): add trusted-devices and webauthn migrations"
```

---

### Task 2: Backend cookie support

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Produces: `req.cookies` populated on every request (used by Task 4/6).

- [ ] **Step 1: Add dependencies**

```bash
cd backend
npm install cookie-parser@^1.4.7
npm install -D @types/cookie-parser@^1.4.7
```

- [ ] **Step 2: Wire `cookie-parser` in `backend/src/main.ts`**

Add the import at the top and the `app.use()` call right after `app.use(helmet())`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    new Logger('Bootstrap').warn(
      'GITHUB_WEBHOOK_SECRET is not set — POST /api/v1/webhooks/github will accept ' +
        'unsigned requests from anyone. Set it (repo → Settings → Webhooks → Secret) before ' +
        'exposing this endpoint publicly.',
    );
  }

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.DASHBOARD_ORIGIN?.split(',') ?? '*',
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend listening on :${port}`);
}
bootstrap();
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/main.ts
git commit -m "feat(auth): add cookie-parser for trusted-device cookies"
```

---

### Task 3: `TrustedDeviceService`

**Files:**
- Modify: `backend/src/common/hash.util.ts` (no change needed — reused as reference pattern only, not imported)
- Create: `backend/src/auth/trusted-device.service.ts`
- Test: `backend/src/auth/trusted-device.service.spec.ts`

**Interfaces:**
- Produces: `TrustedDeviceService` with `hash(token)`, `labelFromUserAgent(ua?)`, `issue(userId, ua?, ip?) → { token, expiresAt }`, `verify(userId, rawToken?) → boolean`, `list(userId, currentTokenHash) → TrustedDeviceRow[]`, `revoke(userId, id, currentTokenHash) → { revoked, wasCurrent }`, `revokeAll(userId) → void`. Consumed by Task 4 (`AuthService`) and Task 6 (`AuthController`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/auth/trusted-device.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest trusted-device.service.spec.ts`
Expected: FAIL — `Cannot find module './trusted-device.service'`.

- [ ] **Step 3: Implement `backend/src/auth/trusted-device.service.ts`**

```ts
import { Injectable, Inject } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const TRUST_DAYS = 7;

export interface TrustedDeviceRow {
  id: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  is_current: boolean;
}

@Injectable()
export class TrustedDeviceService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** sha256 hex of a raw device token. Only this hash is ever persisted. */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Human-readable label parsed from a User-Agent header, e.g. "Chrome on Windows". */
  labelFromUserAgent(ua?: string): string {
    if (!ua) return 'Unknown device';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os =
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad/.test(ua) ? 'iOS' :
      /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    return `${browser} on ${os}`;
  }

  /** Mint a new trusted-device token, store its hash, and return the RAW token
   *  (handed to the caller exactly once, for the cookie) plus its fixed 7-day expiry. */
  async issue(userId: string, ua: string | undefined, ip: string | undefined) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO trusted_devices (user_id, token_hash, label, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, this.hash(token), this.labelFromUserAgent(ua), ip ?? null, expiresAt],
    );
    return { token, expiresAt };
  }

  /** True if rawToken matches an active (unrevoked, unexpired) device for this user.
   *  Bumps last_used_at on a hit. A missing/expired/revoked/unknown token is just `false`. */
  async verify(userId: string, rawToken: string | undefined): Promise<boolean> {
    if (!rawToken) return false;
    const { rows } = await this.pool.query(
      `UPDATE trusted_devices SET last_used_at = now()
       WHERE user_id = $1 AND token_hash = $2
         AND revoked_at IS NULL AND expires_at > now()
       RETURNING id`,
      [userId, this.hash(rawToken)],
    );
    return rows.length > 0;
  }

  /** currentTokenHash (from the caller's own cookie, or null) flags which row is "this device". */
  async list(userId: string, currentTokenHash: string | null): Promise<TrustedDeviceRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, label, created_at, last_used_at, expires_at,
              (token_hash = $2) AS is_current
       FROM trusted_devices
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC`,
      [userId, currentTokenHash],
    );
    return rows;
  }

  /** Revoke one device. wasCurrent tells the caller whether to also clear the cookie. */
  async revoke(
    userId: string,
    id: string,
    currentTokenHash: string | null,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const { rows } = await this.pool.query(
      `UPDATE trusted_devices SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING (token_hash = $3) AS was_current`,
      [id, userId, currentTokenHash],
    );
    if (rows.length === 0) return { revoked: false, wasCurrent: false };
    return { revoked: true, wasCurrent: rows[0].was_current === true };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest trusted-device.service.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/trusted-device.service.ts backend/src/auth/trusted-device.service.spec.ts
git commit -m "feat(auth): add TrustedDeviceService"
```

---

### Task 4: Wire trusted devices into `AuthService`

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `TrustedDeviceService.verify(userId, rawToken?) → boolean`, `TrustedDeviceService.issue(userId, ua?, ip?) → { token, expiresAt }` (Task 3).
- Produces: `AuthService.login(email, password, deviceToken?)`, `AuthService.verifyMfa(mfaToken, code, trustDevice, ua?, ip?)`, `AuthService.enrollMfa(mfaToken, code, trustDevice, ua?, ip?)`, `AuthService.signChallenge(scope, sub, challenge) → string`, `AuthService.verifyChallenge(scope, token, expectedSub?) → claims`, `AuthService.issueAccessToken(user) → { access_token, user }`. Consumed by Task 5 (`PasskeyService` doesn't call these, but Task 6 `AuthController` does) and Task 6.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/auth/auth.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest auth.service.spec.ts`
Expected: FAIL — `AuthService` constructor currently takes 2 args, not 3; `signChallenge`/`verifyChallenge` don't exist yet.

- [ ] **Step 3: Rewrite `backend/src/auth/auth.service.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest auth.service.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck the whole backend**

Run: `cd backend && npx tsc --noEmit`
Expected: errors only in `auth.module.ts`/`auth.controller.ts` (not yet updated — fixed in Task 6). If there are unrelated errors, stop and investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): skip OTP for trusted devices, generalize challenge tokens"
```

---

### Task 5: `PasskeyService`

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/auth/passkey.service.ts`
- Test: `backend/src/auth/passkey.service.spec.ts`

**Interfaces:**
- Produces: `PasskeyService` with `registrationOptions(userId, email) → options`, `verifyRegistration(userId, expectedChallenge, response) → void`, `authenticationOptions(email) → { options, userId? }`, `verifyAuthentication(expectedChallenge, response) → { id, email, role }`, `list(userId) → PasskeyRow[]`, `remove(userId, id) → boolean`. Consumed by Task 6 (`AuthController`).

- [ ] **Step 1: Add dependency**

```bash
cd backend
npm install @simplewebauthn/server@^10.0.1
```

- [ ] **Step 2: Write the failing tests**

Create `backend/src/auth/passkey.service.spec.ts`:

```ts
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'reg-challenge' }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'auth-challenge' }),
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
        credential: { id: 'cred-1', publicKey: Buffer.from('pubkey'), counter: 0 },
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest passkey.service.spec.ts`
Expected: FAIL — `Cannot find module './passkey.service'`.

- [ ] **Step 4: Implement `backend/src/auth/passkey.service.ts`**

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { PG_POOL } from '../database/database.module';

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Monitoring Platform';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `http://${RP_ID}:5173`;

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
    const { credential, credentialDeviceType } = verification.registrationInfo;
    await this.pool.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, counter, device_type, transports, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64url'),
        credential.counter,
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
    // Empty allowCredentials when the email is unknown — still returns a
    // usable-shaped challenge so the endpoint doesn't leak account existence.
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
      credential: {
        id: response.id,
        publicKey: Buffer.from(row.public_key, 'base64url'),
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest passkey.service.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck against the actually-installed library version**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors from `passkey.service.ts`. `@simplewebauthn/server`'s public types have shifted field names across majors before (e.g. `credential.id` vs `credentialID`, `credentialPublicKey` vs `credential.publicKey`) — if `tsc` reports a mismatch here, open `node_modules/@simplewebauthn/server/esm/index.d.ts` (or the package's exported types) to see the installed version's actual shape and adjust the field names in `passkey.service.ts` (and the corresponding mock shape in `passkey.service.spec.ts`) to match. Do not suppress with `any` beyond what's already used for `response`.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/auth/passkey.service.ts backend/src/auth/passkey.service.spec.ts
git commit -m "feat(auth): add PasskeyService for WebAuthn registration and login"
```

---

### Task 6: `AuthController` routes + `AuthModule` wiring

**Files:**
- Modify: `backend/src/auth/auth.controller.ts`
- Modify: `backend/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `AuthService` (Task 4), `TrustedDeviceService` (Task 3), `PasskeyService` (Task 5).
- Produces: routes `POST /auth/login` (updated), `POST /auth/mfa/verify` (updated), `POST /auth/mfa/enroll` (updated), `GET /auth/devices`, `DELETE /auth/devices`, `DELETE /auth/devices/:id`, `GET /auth/passkeys`, `DELETE /auth/passkeys/:id`, `POST /auth/passkeys/register/options`, `POST /auth/passkeys/register/verify`, `POST /auth/passkeys/login/options`, `POST /auth/passkeys/login/verify`. Consumed by Task 7 (`dashboard/lib/api.js`).

No new unit test file for this task — it's Nest wiring (guards, cookies, routing) with no business logic of its own; Task 4/5's unit tests cover the logic it calls, and Task 10 exercises every route for real over HTTP/WebAuthn in the browser, which is what actually matters for glue code like this.

- [ ] **Step 1: Rewrite `backend/src/auth/auth.controller.ts`**

```ts
import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsObject, IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TrustedDeviceService } from './trusted-device.service';
import { PasskeyService } from './passkey.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

const DEVICE_COOKIE = 'device_token';
const DEVICE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class MfaDto {
  @IsString() mfa_token!: string;
  @IsString() code!: string;
  @IsOptional() @IsBoolean() trust_device?: boolean;
}

class PasskeyEmailDto {
  @IsEmail() email!: string;
}

class PasskeyRegisterVerifyDto {
  @IsString() reg_token!: string;
  @IsObject() credential!: Record<string, any>;
}

class PasskeyLoginVerifyDto {
  @IsString() auth_token!: string;
  @IsObject() credential!: Record<string, any>;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly passkeys: PasskeyService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, req.cookies?.[DEVICE_COOKIE]);
  }

  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyMfa(
      dto.mfa_token, dto.code, !!dto.trust_device, req.headers['user-agent'], req.ip,
    );
    return this.finishWithDeviceCookie(result, res);
  }

  @Post('mfa/enroll')
  async enrollMfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.enrollMfa(
      dto.mfa_token, dto.code, !!dto.trust_device, req.headers['user-agent'], req.ip,
    );
    return this.finishWithDeviceCookie(result, res);
  }

  private finishWithDeviceCookie(result: any, res: Response) {
    if (result.device_token) {
      res.cookie(DEVICE_COOKIE, result.device_token, DEVICE_COOKIE_OPTS);
      delete result.device_token;
      delete result.device_expires_at;
    }
    return result;
  }

  // Returns the current authenticated user (from the JWT).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }

  // ── Trusted devices ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  listDevices(@Req() req: any) {
    const currentTokenHash = req.cookies?.[DEVICE_COOKIE] ? this.trustedDevices.hash(req.cookies[DEVICE_COOKIE]) : null;
    return this.trustedDevices.list(req.user.sub, currentTokenHash);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices')
  async revokeAllDevices(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    await this.trustedDevices.revokeAll(req.user.sub);
    res.clearCookie(DEVICE_COOKIE, { path: '/api/v1/auth' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices/:id')
  async revokeDevice(@Param('id') id: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const currentTokenHash = req.cookies?.[DEVICE_COOKIE] ? this.trustedDevices.hash(req.cookies[DEVICE_COOKIE]) : null;
    const { revoked, wasCurrent } = await this.trustedDevices.revoke(req.user.sub, id, currentTokenHash);
    if (wasCurrent) res.clearCookie(DEVICE_COOKIE, { path: '/api/v1/auth' });
    return { ok: revoked };
  }

  // ── Passkeys: management (must be logged in) ────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('passkeys')
  listPasskeys(@Req() req: any) {
    return this.passkeys.list(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('passkeys/:id')
  async removePasskey(@Param('id') id: string, @Req() req: any) {
    return { ok: await this.passkeys.remove(req.user.sub, id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/register/options')
  async passkeyRegisterOptions(@Req() req: any) {
    const options = await this.passkeys.registrationOptions(req.user.sub, req.user.email);
    const reg_token = this.auth.signChallenge('passkey_reg', req.user.sub, options.challenge);
    return { options, reg_token };
  }

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/register/verify')
  async passkeyRegisterVerify(@Body() dto: PasskeyRegisterVerifyDto, @Req() req: any) {
    const claims = this.auth.verifyChallenge('passkey_reg', dto.reg_token, req.user.sub);
    await this.passkeys.verifyRegistration(req.user.sub, claims.challenge, dto.credential);
    return { ok: true };
  }

  // ── Passkeys: passwordless login (unauthenticated) ──────────────────────
  @Post('passkeys/login/options')
  async passkeyLoginOptions(@Body() dto: PasskeyEmailDto) {
    const { options, userId } = await this.passkeys.authenticationOptions(dto.email);
    const auth_token = this.auth.signChallenge('passkey_auth', userId ?? 'unknown', options.challenge);
    return { options, auth_token };
  }

  @Post('passkeys/login/verify')
  async passkeyLoginVerify(@Body() dto: PasskeyLoginVerifyDto) {
    const claims = this.auth.verifyChallenge('passkey_auth', dto.auth_token);
    const user = await this.passkeys.verifyAuthentication(claims.challenge, dto.credential);
    return this.auth.issueAccessToken(user);
  }
}
```

- [ ] **Step 2: Update `backend/src/auth/auth.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TrustedDeviceService } from './trusted-device.service';
import { PasskeyService } from './passkey.service';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TrustedDeviceService, PasskeyService],
})
export class AuthModule {}
```

- [ ] **Step 3: Typecheck and run the full backend test suite**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: no type errors, all suites (including the pre-existing ones) pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/auth/auth.controller.ts backend/src/auth/auth.module.ts
git commit -m "feat(auth): add trusted-device and passkey routes to AuthController"
```

---

### Task 7: `dashboard/lib/api.js` client methods

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/lib/api.js`

**Interfaces:**
- Consumes: routes from Task 6.
- Produces: `api.mfaVerify(mfa_token, code, trust_device)`, `api.mfaEnroll(mfa_token, code, trust_device)`, `api.passkeyLoginOptions(email)`, `api.passkeyLoginVerify(auth_token, credential)`, `api.passkeyRegisterOptions()`, `api.passkeyRegisterVerify(reg_token, credential)`, `api.myPasskeys()`, `api.deletePasskey(id)`, `api.myTrustedDevices()`, `api.revokeTrustedDevice(id)`, `api.revokeAllTrustedDevices()`. Consumed by Task 8 and Task 9.

- [ ] **Step 1: Add the frontend WebAuthn dependency**

```bash
cd dashboard
npm install @simplewebauthn/browser@^10.0.0
```

- [ ] **Step 2: Add `credentials: 'include'` to `req()` in `dashboard/lib/api.js`**

```js
async function req(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
```

(Rest of `req()` unchanged.)

- [ ] **Step 3: Update `mfaVerify`/`mfaEnroll` and add the new methods**

Replace:

```js
  mfaVerify: (mfa_token, code) =>
    req('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfa_token, code }) }),
  mfaEnroll: (mfa_token, code) =>
    req('/auth/mfa/enroll', { method: 'POST', body: JSON.stringify({ mfa_token, code }) }),
```

with:

```js
  mfaVerify: (mfa_token, code, trust_device = false) =>
    req('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfa_token, code, trust_device }) }),
  mfaEnroll: (mfa_token, code, trust_device = false) =>
    req('/auth/mfa/enroll', { method: 'POST', body: JSON.stringify({ mfa_token, code, trust_device }) }),
  // passkeys (passwordless login + management)
  passkeyLoginOptions: (email) =>
    req('/auth/passkeys/login/options', { method: 'POST', body: JSON.stringify({ email }) }),
  passkeyLoginVerify: (auth_token, credential) =>
    req('/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ auth_token, credential }) }),
  passkeyRegisterOptions: () => req('/auth/passkeys/register/options', { method: 'POST' }),
  passkeyRegisterVerify: (reg_token, credential) =>
    req('/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ reg_token, credential }) }),
  myPasskeys: () => req('/auth/passkeys'),
  deletePasskey: (id) => req(`/auth/passkeys/${id}`, { method: 'DELETE' }),
  // trusted devices
  myTrustedDevices: () => req('/auth/devices'),
  revokeTrustedDevice: (id) => req(`/auth/devices/${id}`, { method: 'DELETE' }),
  revokeAllTrustedDevices: () => req('/auth/devices', { method: 'DELETE' }),
```

- [ ] **Step 4: Lint**

Run: `cd dashboard && npx eslint lib/api.js`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/lib/api.js
git commit -m "feat(auth): add trusted-device and passkey API client methods"
```

---

### Task 8: Login page — passkey sign-in + trust-device checkbox

**Files:**
- Modify: `dashboard/app/login/page.jsx`

**Interfaces:**
- Consumes: `api.passkeyLoginOptions`, `api.passkeyLoginVerify`, `api.mfaVerify(mfa_token, code, trust_device)`, `api.mfaEnroll(mfa_token, code, trust_device)` (Task 7), `startAuthentication` from `@simplewebauthn/browser`.

- [ ] **Step 1: Rewrite `dashboard/app/login/page.jsx`**

```jsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, setToken, setRole } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  // step: 'password' | 'setup' (first-time enrollment) | 'verify' (enrolled)
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const finish = ({ access_token, user }) => {
    setToken(access_token);
    setRole(user?.role);
    router.push('/');
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await api.login(email, password);
      setMfaToken(res.mfa_token);
      if (res.mfa_setup_required) {
        setQr(res.qr);
        setSecret(res.secret);
        setStep('setup');
      } else if (res.mfa_required) {
        setStep('verify');
      } else {
        // Either MFA isn't enabled yet, or this browser is a trusted device.
        finish(res);
      }
    } catch {
      setErr('Invalid credentials');
    } finally {
      setBusy(false);
    }
  };

  const signInWithPasskey = async () => {
    if (!email.trim()) {
      setErr('Enter your email first, then choose a passkey');
      return;
    }
    setErr('');
    setPasskeyBusy(true);
    try {
      const { options, auth_token } = await api.passkeyLoginOptions(email);
      const credential = await startAuthentication({ optionsJSON: options });
      const res = await api.passkeyLoginVerify(auth_token, credential);
      finish(res);
    } catch (ex) {
      setErr(ex?.message || 'Passkey sign-in failed or was cancelled');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res =
        step === 'setup'
          ? await api.mfaEnroll(mfaToken, code, trustDevice)
          : await api.mfaVerify(mfaToken, code, trustDevice);
      finish(res);
    } catch (ex) {
      setErr(ex?.message || 'Invalid authentication code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      {step === 'password' && (
        <form className="login-card" onSubmit={submitPassword} autoComplete="off">
          <h1>🛡️ Monitoring Platform</h1>
          <label>Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label>Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button
            type="button"
            onClick={signInWithPasskey}
            disabled={passkeyBusy}
            style={{ marginTop: 8, background: 'transparent', border: '1px solid var(--border)' }}
          >
            {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
          </button>
        </form>
      )}

      {step === 'setup' && (
        <form className="login-card" onSubmit={submitCode} autoComplete="off">
          <h1>Set up two-factor auth</h1>
          <p>Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to finish.</p>
          {qr && <img src={qr} alt="TOTP QR code" style={{ width: 180, height: 180, alignSelf: 'center' }} />}
          {secret && (
            <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Can’t scan? Enter this key manually: <code>{secret}</code>
            </p>
          )}
          <label>Authentication code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Trust this device for 7 days — don't ask for a code again here
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
        </form>
      )}

      {step === 'verify' && (
        <form className="login-card" onSubmit={submitCode} autoComplete="off">
          <h1>Two-factor authentication</h1>
          <p>Enter the 6-digit code from your authenticator app.</p>
          <label>Authentication code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Trust this device for 7 days — don't ask for a code again here
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd dashboard && npx eslint app/login/page.jsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/login/page.jsx
git commit -m "feat(auth): add passkey sign-in and trust-device checkbox to login page"
```

---

### Task 9: Settings page — Security section

**Files:**
- Modify: `dashboard/app/(app)/settings/page.jsx`

**Interfaces:**
- Consumes: `api.myTrustedDevices`, `api.revokeTrustedDevice`, `api.revokeAllTrustedDevices`, `api.myPasskeys`, `api.deletePasskey`, `api.passkeyRegisterOptions`, `api.passkeyRegisterVerify` (Task 7), `startRegistration` from `@simplewebauthn/browser`.

- [ ] **Step 1: Add the `startRegistration` import and a `SecuritySection` component to `dashboard/app/(app)/settings/page.jsx`**

Add the import at the top, alongside the existing ones:

```js
import { startRegistration } from '@simplewebauthn/browser';
```

Add this component after `SmtpSection` and before `// ── Main Page ──`:

```jsx
// ── Security Section (passkeys + trusted devices) ─────────────────────────
function SecuritySection() {
  const [devices, setDevices] = useState([]);
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ msg: '', ok: true });
  const [addingPasskey, setAddingPasskey] = useState(false);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: '', ok: true }), 4000);
  };

  const load = () => {
    setLoading(true);
    Promise.all([api.myTrustedDevices(), api.myPasskeys()])
      .then(([d, p]) => { setDevices(d); setPasskeys(p); })
      .catch((e) => notify(e.message, false))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const revokeDevice = async (id) => {
    try { await api.revokeTrustedDevice(id); notify('Device revoked'); load(); }
    catch (e) { notify(e.message, false); }
  };

  const revokeAll = async () => {
    try { await api.revokeAllTrustedDevices(); notify('All devices revoked'); load(); }
    catch (e) { notify(e.message, false); }
  };

  const addPasskey = async () => {
    setAddingPasskey(true);
    try {
      const { options, reg_token } = await api.passkeyRegisterOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.passkeyRegisterVerify(reg_token, credential);
      notify('Passkey added');
      load();
    } catch (e) {
      notify(e.message || 'Could not add passkey', false);
    } finally {
      setAddingPasskey(false);
    }
  };

  const removePasskey = async (id) => {
    try { await api.deletePasskey(id); notify('Passkey removed'); load(); }
    catch (e) { notify(e.message, false); }
  };

  if (loading) {
    return (
      <Section title="Security" description="Passkeys and trusted devices for your account.">
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      </Section>
    );
  }

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
  };
  const smallBtn = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--panel-2)', cursor: 'pointer', fontSize: 12, color: 'var(--fg, var(--text))',
  };

  return (
    <Section title="Security" description="Passkeys and trusted devices for your account.">
      {toast.msg && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: toast.ok ? '#d1fae522' : '#fee2e222',
          border: `1px solid ${toast.ok ? '#34d399' : '#f87171'}`,
          color: toast.ok ? '#065f46' : '#991b1b',
        }}>{toast.msg}</div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Passkeys</div>
          <button className="btn-primary" onClick={addPasskey} disabled={addingPasskey}>
            {addingPasskey ? 'Waiting for device…' : 'Add a passkey'}
          </button>
        </div>
        {passkeys.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No passkeys registered yet.</div>}
        {passkeys.map((p) => (
          <div key={p.id} style={rowStyle}>
            <div>
              <div>{p.label || 'Passkey'}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Added {new Date(p.created_at).toLocaleDateString()}
                {p.last_used_at && ` · last used ${new Date(p.last_used_at).toLocaleDateString()}`}
              </div>
            </div>
            <button onClick={() => removePasskey(p.id)} style={smallBtn}>Remove</button>
          </div>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Trusted devices</div>
          {devices.length > 0 && <button onClick={revokeAll} style={smallBtn}>Revoke all</button>}
        </div>
        {devices.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No trusted devices.</div>}
        {devices.map((d) => (
          <div key={d.id} style={rowStyle}>
            <div>
              <div>
                {d.label || 'Unknown device'}
                {d.is_current && <span style={{ color: 'var(--accent)', fontWeight: 700 }}> · This device</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Last used {new Date(d.last_used_at).toLocaleDateString()} · trusted until {new Date(d.expires_at).toLocaleDateString()}
              </div>
            </div>
            <button onClick={() => revokeDevice(d.id)} style={smallBtn}>Revoke</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
```

Add `<SecuritySection />` to the render in `SettingsPage`:

```jsx
export default function SettingsPage() {
  return (
    <div>
      <div className="page-head">
        <h2>Settings</h2>
        <span className="muted">Appearance &amp; platform configuration</span>
      </div>

      <ThemeSection />
      <SecuritySection />
      <SmtpSection />
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd dashboard && npx eslint "app/(app)/settings/page.jsx"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/(app)/settings/page.jsx"
git commit -m "feat(auth): add Security section (passkeys, trusted devices) to Settings"
```

---

### Task 10: Run on Docker and test end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Build and start the full dev stack**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

- [ ] **Step 2: Confirm migrations applied cleanly**

Run: `docker compose logs backend | grep -i "migration\|Admin ready\|listening"`
Expected: lines for every migration including `Applying trusted-devices migration...` and `Applying webauthn migration...`, then `Admin ready: admin@example.com / admin123` and `Backend listening on :4000`. If a step errors, read the surrounding log output — a earlier migration failing will abort the chain — and fix before continuing (do not skip ahead).

- [ ] **Step 3: Confirm both new tables exist**

```bash
docker compose exec db psql -U monitor -d monitoring -c "\d trusted_devices" -c "\d webauthn_credentials"
```

Expected: both tables listed with the columns defined in Task 1.

- [ ] **Step 4: Open the dashboard in the browser and log in as the seeded admin**

Use the Browser tool to navigate to `http://localhost:5173/login`, sign in with `admin@example.com` / `admin123`. Complete the TOTP enrollment step (scan the QR with any TOTP tool, or read `secret` and compute a code) — check the **"Trust this device for 7 days"** box before submitting.

Expected: lands on the dashboard home page (not bounced back to `/login`).

- [ ] **Step 5: Verify the trusted-device cookie skips OTP on next login**

Log out (clear `localStorage` token — or just navigate to `/login` directly) and log in again with the same credentials, same browser tab.

Expected: goes straight to the dashboard — no OTP prompt this time, confirming the `device_token` cookie round-tripped and `AuthService.login`'s trusted-device branch fired.

- [ ] **Step 6: Verify the device shows up in Settings → Security**

Navigate to `http://localhost:5173/settings`. In the "Trusted devices" list, confirm one entry is present, labeled with the test browser/OS and marked "This device". Click **Revoke**, then repeat Step 5's login.

Expected: after revoking, the next login prompts for the OTP code again (the skip no longer applies).

- [ ] **Step 7: Verify passkey registration and passwordless login**

While logged in, go to Settings → Security → "Add a passkey" and complete the WebAuthn ceremony (the Browser tool's environment needs a platform authenticator available — if none is available in this sandboxed browser, note that limitation explicitly rather than forcing it; this step may need to be done in a real desktop/mobile browser with Windows Hello / Touch ID / a security key instead). Confirm the new passkey appears in the list with today's date.

Log out, go to `/login`, type the admin email, click **"Sign in with a passkey"**, complete the ceremony.

Expected: lands on the dashboard home page without ever entering a password or OTP code.

- [ ] **Step 8: Check backend logs for unexpected errors during the whole test pass**

Run: `docker compose logs backend --since 10m | grep -i error`
Expected: no unhandled exceptions related to `/auth/*` routes. (Unrelated pre-existing warnings, e.g. the `GITHUB_WEBHOOK_SECRET` warning, are expected and fine.)

- [ ] **Step 9: Tear down**

```bash
docker compose down
```

(Leave `-v`/volumes intact — don't wipe `dbdata` unless the user asks for a clean slate.)

No commit for this task — it's verification of the already-committed work from Tasks 1–9.
