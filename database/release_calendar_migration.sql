-- =====================================================================
-- Release Calendar & Scheduling: planned release dates, scheduled
-- deployments (execute automatically at a future time instead of on
-- create/approve), and freeze/blackout windows that block deploys.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / ADD VALUE IF NOT EXISTS / guarded
-- index recreate). Apply after release_migration.sql, deploy_jobs_migration.sql
-- and deploy_cancel_migration.sql (needs deployments, channels, the
-- deploy_status enum, and uq_deployments_active_channel).
--   psql -U monitor -d monitoring -f database/release_calendar_migration.sql
-- =====================================================================

ALTER TABLE releases ADD COLUMN IF NOT EXISTS planned_date DATE;

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- 'scheduled' deployments wait for scheduled_at before executing
-- (DeploymentsService.sweepScheduledDeployments, a once-a-minute sweep).
-- Not referenced elsewhere in this file, so the PG12+ restriction on using a
-- freshly-added enum label in the same transaction doesn't apply here.
ALTER TYPE deploy_status ADD VALUE IF NOT EXISTS 'scheduled';

-- Deploys — immediate or scheduled — are blocked while an overlapping window
-- is active for the target channel/product (NULL channel_id/product_id = all).
CREATE TABLE IF NOT EXISTS deployment_freeze_windows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  channel_id  UUID REFERENCES channels(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  reason      TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT freeze_window_range CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_freeze_windows_range ON deployment_freeze_windows (starts_at, ends_at);

-- Widen the "only one active deployment per channel" backstop
-- (deploy_cancel_migration.sql) to also cover 'scheduled' — a scheduled
-- deployment reserves the channel the same way pending/approved/in_progress do.
DROP INDEX IF EXISTS uq_deployments_active_channel;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_active_channel
  ON deployments (channel_id) WHERE status IN ('pending','approved','in_progress','scheduled');
