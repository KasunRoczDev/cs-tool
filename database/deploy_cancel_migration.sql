-- =====================================================================
-- Deployment cancel/retry + same-channel concurrency guard.
-- Apply after release_migration.sql (deployments, channels) and
-- deploy_jobs_migration.sql (deploy_jobs).
--   psql -U monitor -d monitoring -f database/deploy_cancel_migration.sql
-- =====================================================================

-- 'cancelled' terminal state for deployments. deploy_jobs.status is already a
-- free-text column (allows 'cancelled' today); deployments.status is the
-- deploy_status ENUM and needs the value added explicitly. Not referenced by
-- any statement below in this same transaction, so the PG12+ same-transaction
-- restriction on using a freshly-added enum label doesn't apply here.
ALTER TYPE deploy_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Prevent two deployments from running concurrently on the same channel —
-- app-level check in DeploymentsService.deploy() is the friendly error path;
-- this index is the race-safe backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_active_channel
  ON deployments (channel_id) WHERE status IN ('pending','approved','in_progress');
