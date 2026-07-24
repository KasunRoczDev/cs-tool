# Trusted Devices, 7-Day OTP Skip, and Passwordless Passkeys

Status: Approved
Date: 2026-07-24

## Problem

The platform requires TOTP MFA on every login (`backend/src/auth/`), which is
correct but adds friction for users on devices they already trust. We're
adding:

1. **Trusted Devices** — a "trust this device for 7 days" option that skips
   the OTP-code step (password is still always required) for 7 days from
   when it was granted.
2. **Passkeys (WebAuthn)** — a fully passwordless sign-in option, as an
   alternative to password + OTP, for users who register one.

## Existing architecture (context)

- Auth is stateless JWT, bearer token in `localStorage` (`dashboard/lib/api.js`).
  No cookies are used anywhere in the app today.
- `backend/src/auth/auth.service.ts` uses a recurring pattern: instead of a
  server-side session store, short-lived *state* (e.g. the TOTP secret during
  enrollment) is carried inside a signed, scope-tagged JWT (`mfa_token`) that
  the client round-trips on the next call. We reuse this pattern for WebAuthn
  challenges instead of introducing session storage.
- `users.id` is `UUID` (`gen_random_uuid()`), consistent across all tables.
- Backend CORS (`backend/src/main.ts`) already sets `credentials: true` with a
  configurable `DASHBOARD_ORIGIN`, so introducing a cookie is a small addition
  (needs `cookie-parser`), not a new CORS setup.
- Migrations are individual idempotent `.sql` files under `database/`, each
  wired into `backend/scripts/migrate.js` in dependency order.

## Data model

### `database/trusted_devices_migration.sql`

```sql
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,   -- sha256 of the raw cookie value
  label        TEXT,                  -- parsed from User-Agent
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,  -- created_at + 7 days, FIXED (not rolling)
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
```

The raw token is never persisted — only its sha256 hash, mirroring
`hashApiKey()` in `backend/src/common/hash.util.ts`.

### `database/webauthn_migration.sql`

```sql
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,   -- base64url
  public_key    TEXT NOT NULL,          -- base64url
  counter       BIGINT NOT NULL DEFAULT 0,
  device_type   TEXT,                   -- 'singleDevice' | 'multiDevice'
  transports    TEXT[],
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
```

Both files follow the existing idempotent-migration convention and are added
to `backend/scripts/migrate.js` after `rbac_migration.sql`.

## Backend flow

### Trusted device — skip OTP for 7 days

1. `POST /auth/login` additionally reads the `device_token` cookie. If
   `mfa_enabled` is true **and** the cookie's sha256 hash matches an active
   (`revoked_at IS NULL AND expires_at > now()`) `trusted_devices` row for
   that user, skip MFA and return a full `access_token` directly. Password is
   still always checked first — only the OTP step is skipped.
2. Otherwise, today's `mfa_required` / `mfa_setup_required` behavior is
   unchanged.
3. `POST /auth/mfa/verify` and `POST /auth/mfa/enroll` accept an optional
   `trust_device: boolean`. When true: generate a random 32-byte token,
   insert a `trusted_devices` row (`token_hash` = sha256, `label` parsed from
   `User-Agent`, `expires_at = now() + 7 days`), and set it as a cookie:
   `httpOnly`, `SameSite=Lax`, `Secure` in production, `maxAge` 7 days, path
   `/api/v1/auth`.
4. A cookie that doesn't match any active row (expired, revoked, unknown) is
   treated as absent — falls through to a normal OTP prompt, no error shown,
   and the stale cookie is cleared in the response.

### Device management (JWT-authenticated)

- `GET /auth/devices` — list the caller's devices; flags which one is the
  current browser (cookie match).
- `DELETE /auth/devices/:id` — revoke one (sets `revoked_at`); clears the
  cookie if it's the current device.
- `DELETE /auth/devices` — revoke all.

### Passkeys — passwordless login

Uses `@simplewebauthn/server` (new backend dependency).

**Registration** (must already be logged in; done from Settings):
- `POST /auth/passkeys/register/options` — `generateRegistrationOptions()`
  using `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` env vars (sensible defaults for
  dev). Returns the options plus a signed JWT `{ sub, scope: 'passkey_reg',
  challenge }`, 5-minute TTL — same pattern as the existing `mfa_token`.
- `POST /auth/passkeys/register/verify` — `{ reg_token, credential }` →
  `verifyRegistrationResponse()`; on success, insert into
  `webauthn_credentials`.
- `GET /auth/passkeys` / `DELETE /auth/passkeys/:id` — list/remove.

**Authentication** (unauthenticated, email-first, replaces password + OTP):
- `POST /auth/passkeys/login/options` — `{ email }` → looks up that user's
  credentials, returns `generateAuthenticationOptions()` plus a signed
  `passkey_auth` challenge token (5 min TTL). If the email has no
  credentials, still returns a shaped dummy challenge to avoid leaking which
  emails have passkeys registered.
- `POST /auth/passkeys/login/verify` — `{ auth_token, credential }` →
  `verifyAuthenticationResponse()` against the stored public key/counter,
  updates `counter` + `last_used_at`, issues a full `access_token`. No OTP
  step: a WebAuthn ceremony (device biometric/PIN + private key) is itself
  phishing-resistant possession+inherence, standing in for MFA.

## Frontend flow

New dependency: `@simplewebauthn/browser`.

**`dashboard/app/login/page.jsx`**
- Password step: add a "Sign in with a passkey" option. Uses the email
  already typed (or prompts for it) → `passkeys/login/options` →
  `startAuthentication()` → `passkeys/login/verify` → existing `finish()`.
- `verify` and `setup` steps: add a "Trust this device for 7 days" checkbox
  (default unchecked), passed as `trust_device` on the verify/enroll call.

**`dashboard/lib/api.js`**
- `req()` gains `credentials: 'include'` so the cookie round-trips
  cross-origin in dev.
- New methods: `passkeyLoginOptions`, `passkeyLoginVerify`,
  `passkeyRegisterOptions`, `passkeyRegisterVerify`, `myTrustedDevices`,
  `revokeTrustedDevice`, `revokeAllTrustedDevices`, `myPasskeys`,
  `deletePasskey`; `mfaVerify`/`mfaEnroll` gain a `trustDevice` param.

**`dashboard/app/(app)/settings/page.jsx`**
- New `SecuritySection`, following the existing `Section`/`Field` visual
  pattern used by `ThemeSection`/`SmtpSection`:
  - **Passkeys** — list (label, created, last used), "Add a passkey" button,
    "Remove" per row.
  - **Trusted devices** — list (label, last used, trusted-until date, "This
    device" badge), "Revoke" per row, "Revoke all other devices" button.

## Error handling

- Invalid/expired/revoked device cookies fail silently into a normal OTP
  prompt — never a hard error.
- Passkey ceremony cancellation/failure surfaces as an inline login error
  ("Passkey sign-in failed or was cancelled").
- WebAuthn requires a secure context (HTTPS or `localhost`); noted in the
  migration file as a deployment consideration.

## Explicitly out of scope

- Login rate-limiting (pre-existing gap across all auth endpoints, not
  specific to this feature).
- Fully "usernameless" discoverable-credential UX (conditional UI/autofill)
  — this design is email-first for passkey login, which is a pragmatic MVP;
  usernameless can be a later enhancement.
- Revoking trusted devices automatically on password change.

## Testing

- New `backend/src/auth/auth.service.spec.ts` covering: trusted-device
  cookie accepted / rejected / expired, and passkey registration/auth
  verification (using `@simplewebauthn/server`'s test helpers to mock the
  ceremony).
- Manual verification in a browser against local dev servers for the actual
  WebAuthn ceremony and the end-to-end 7-day trusted-device skip.
