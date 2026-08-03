-- =====================================================================
-- Per-server agent self-update tracking.
-- Apply after schema.sql (servers).
--   psql -U monitor -d monitoring -f database/agent_update_status_migration.sql
-- =====================================================================

ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_version TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_status TEXT
  NOT NULL DEFAULT 'idle';  -- idle|applying|succeeded|rolled_back|failed
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_message TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_auto_update_excluded BOOLEAN
  NOT NULL DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_last_update_at TIMESTAMPTZ;
