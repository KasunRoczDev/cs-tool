-- =====================================================================
-- Deployment strategies: rolling batches and canary-with-manual-promotion,
-- built on top of the existing agent/server job model. Blue-Green, A/B, and
-- Shadow deployment are intentionally NOT modeled here — they need real
-- traffic-splitting infrastructure (load balancer / service mesh) that this
-- platform doesn't integrate with; faking the labels without real traffic
-- control would be misleading.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / ADD VALUE IF NOT EXISTS / guarded
-- index recreate). Apply after deploy_jobs_migration.sql and
-- deploy_cancel_migration.sql (needs deploy_jobs, deploy_status enum,
-- uq_deployments_active_channel).
--   psql -U monitor -d monitoring -f database/deployment_strategy_migration.sql
-- =====================================================================

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'all_at_once';
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS current_wave INT NOT NULL DEFAULT 1;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS total_waves INT NOT NULL DEFAULT 1;
ALTER TABLE deploy_jobs ADD COLUMN IF NOT EXISTS wave INT NOT NULL DEFAULT 1;

-- A canary's first wave succeeded and is paused awaiting a manual
-- POST /deployments/:id/promote-wave before the remaining servers deploy.
-- The index below uses this same value. Postgres forbids using a freshly-added
-- enum label before it's committed ("unsafe use of new value") — migrate.js
-- applies this value as its own separate query BEFORE this file, so by the
-- time this ADD VALUE IF NOT EXISTS runs (here, as part of this file's batch)
-- it's already a committed no-op, and the index below is safe.
ALTER TYPE deploy_status ADD VALUE IF NOT EXISTS 'awaiting_promotion';

-- Widen the "only one active deployment per channel" backstop to also cover
-- a paused canary — it still reserves the channel while awaiting promotion.
DROP INDEX IF EXISTS uq_deployments_active_channel;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_active_channel
  ON deployments (channel_id)
  WHERE status IN ('pending','approved','in_progress','scheduled','awaiting_promotion');
