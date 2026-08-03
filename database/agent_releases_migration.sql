-- =====================================================================
-- Agent Releases: published monitor-agent .deb packages, signed offline
-- (Ed25519), pulled and self-applied by installed agents.
-- Apply after schema.sql (users) and settings_migration.sql (platform_settings).
--   psql -U monitor -d monitoring -f database/agent_releases_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL UNIQUE,        -- semver, e.g. 1.2.0
  changelog       TEXT,
  package         BYTEA NOT NULL,              -- the .deb contents
  sha256          TEXT NOT NULL,               -- hex digest of `package`, computed server-side
  signature       TEXT NOT NULL,               -- base64 Ed25519 signature of `package`, signed offline
  rollout_percent SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  is_active       BOOLEAN NOT NULL DEFAULT true,  -- per-release kill switch
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_releases_active
  ON agent_releases (is_active, created_at DESC);

-- Global kill switch (in addition to per-release is_active and per-server
-- agent_auto_update_excluded). Read/written through the existing generic
-- platform_settings endpoints (backend/src/settings/).
INSERT INTO platform_settings (key, value) VALUES
  ('agent_auto_update_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
