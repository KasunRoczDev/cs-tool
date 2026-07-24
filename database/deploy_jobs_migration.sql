-- =====================================================================
-- Deploy Jobs: agent-executed CI/CD pipeline per (deployment × server × repo)
-- Apply after release_migration.sql (needs deployments) and schema.sql (servers).
--   psql -U monitor -d monitoring -f database/deploy_jobs_migration.sql
-- =====================================================================

-- One job = "run the release pipeline for <repo> on <server> for this deployment".
-- The monitoring agent on each server pulls its pending jobs (X-Api-Key auth),
-- runs the fixed pipeline (fetch → checkout → install → build → migrate →
-- restart → health check) plus any custom commands, then reports back.
CREATE TABLE IF NOT EXISTS deploy_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id   UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  repository_id   UUID REFERENCES repositories(id) ON DELETE SET NULL,
  repo_slug       TEXT NOT NULL,                 -- app directory name, e.g. oms-master-be
  env_key         TEXT NOT NULL,                 -- channel key: canary|beta|production|enterprise
  env_path        TEXT NOT NULL,                 -- on-server env dir, e.g. oms-production
  branch          TEXT,                          -- branch to deploy (NULL = current)
  commit_sha      TEXT,                          -- optional exact commit to check out
  custom_commands JSONB NOT NULL DEFAULT '[]'::jsonb,  -- extra shell commands
  status          TEXT NOT NULL DEFAULT 'pending',     -- pending|claimed|running|succeeded|failed|cancelled
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name,status,ms}]
  log             TEXT,                          -- combined stdout/stderr
  error           TEXT,
  claimed_at      TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deploy_jobs_deployment ON deploy_jobs (deployment_id);
CREATE INDEX IF NOT EXISTS idx_deploy_jobs_server_status ON deploy_jobs (server_id, status);
