-- =====================================================================
-- Environment variables & secrets (channel-scoped, optionally product-
-- scoped), channel locking, and per-job resolved env vars for the deploy
-- pipeline. Secrets are encrypted at rest (common/crypto.util, same as
-- repository GitHub tokens) and never returned in plaintext by the API.
--
-- Idempotent (CREATE TABLE/ADD COLUMN IF NOT EXISTS). Apply after
-- release_migration.sql (channels) and deploy_jobs_migration.sql (deploy_jobs).
--   psql -U monitor -d monitoring -f database/environment_secrets_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS channel_env_vars (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE, -- NULL = applies to every product on this channel
  key         TEXT NOT NULL,
  value_enc   TEXT,        -- encrypted value when is_secret
  value_plain TEXT,        -- plain value when not is_secret
  is_secret   BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Backstop for the product_id IS NOT NULL case; Postgres treats multiple
  -- NULLs as distinct, so the product_id IS NULL ("global") case is instead
  -- de-duplicated at the app layer (IS NOT DISTINCT FROM check) in EnvironmentService.
  UNIQUE (channel_id, product_id, key)
);
CREATE INDEX IF NOT EXISTS idx_channel_env_vars_channel ON channel_env_vars (channel_id);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS locked_reason TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Resolved ["KEY=VALUE", ...] for this specific job, decrypted at job-creation
-- time and handed to the agent over the existing authenticated claim channel
-- (deploy-agent.controller.ts) — never logged/returned by any other endpoint.
ALTER TABLE deploy_jobs ADD COLUMN IF NOT EXISTS env_vars JSONB NOT NULL DEFAULT '[]'::jsonb;
