-- =====================================================================
-- Recurring deployments: redeploy a fixed release to a channel on a
-- schedule (daily or weekly at a time of day) — e.g. a nightly environment
-- refresh. Each firing goes through the exact same deploy() path as a
-- manual deploy, so it still respects the approval gate, freeze windows,
-- and channel locking; a blocked firing is skipped (logged), not forced.
--
-- Idempotent. Apply after release_migration.sql (channels) and
-- deployment_strategy_migration.sql (strategy/strategy_config columns this
-- reuses the shape of).
--   psql -U monitor -d monitoring -f database/recurring_deployment_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS recurring_deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  server_ids      UUID[] NOT NULL DEFAULT '{}',
  interval_type   TEXT NOT NULL DEFAULT 'daily',   -- daily | weekly
  day_of_week     INT,                              -- 0 (Sun) .. 6 (Sat), required when weekly
  time_of_day     TIME NOT NULL,                    -- UTC, e.g. '02:00'
  strategy        TEXT NOT NULL DEFAULT 'all_at_once',
  strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_deployment_interval CHECK (
    (interval_type = 'daily') OR (interval_type = 'weekly' AND day_of_week BETWEEN 0 AND 6)
  )
);
CREATE INDEX IF NOT EXISTS idx_recurring_deployments_enabled ON recurring_deployments (enabled);
