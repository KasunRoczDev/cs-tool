-- =====================================================================
-- Release workflow configuration follow-up.
--
-- Widens releases.status from the fixed release_channel ENUM (draft/canary/
-- beta/production/enterprise/archived) to free TEXT, so per-product custom
-- workflows (release_workflows/release_statuses/release_transitions, added
-- by rbac_migration.sql) can define status keys outside that set without
-- StatusService.transition() crashing on an invalid-enum-value error when it
-- writes releases.status. release_statuses/releases.status_id remain the
-- source of truth for the status machine; this column stays only as a
-- best-effort legacy mirror. channels.key keeps the release_channel enum —
-- the deploy pipeline stages are not part of this configurable workflow.
--
-- Idempotent (ALTER COLUMN TYPE to the same type is a harmless no-op).
-- Apply after rbac_migration.sql.
--   psql -U monitor -d monitoring -f database/release_workflow_config_migration.sql
-- =====================================================================

ALTER TABLE releases ALTER COLUMN status DROP DEFAULT;
ALTER TABLE releases ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE releases ALTER COLUMN status SET DEFAULT 'draft';
