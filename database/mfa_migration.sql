-- MFA (TOTP) support for dashboard users.
-- Apply: psql "$DATABASE_URL" -f database/mfa_migration.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret  TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

-- mfa_secret  : base32 TOTP secret, set once the user verifies their first code.
-- mfa_enabled : true after successful enrollment. With "required for all",
--               users with mfa_enabled=false are forced through setup at login.
