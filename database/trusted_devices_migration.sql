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
