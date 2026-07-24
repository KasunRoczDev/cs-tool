-- =====================================================================
-- Release Management — copied from the Release & DevOps Platform blueprint
-- (Core + Deployments board) into the monitoring platform.
--
-- Adds repositories, versions, releases, release composition, deployment
-- channels and a channel pipeline (canary -> beta -> production -> enterprise)
-- with first-class rollback. PKs use UUID/gen_random_uuid() to match the
-- monitoring schema (schema.sql) rather than the blueprint's ULID-as-text.
--
-- Idempotent: IF NOT EXISTS / DO $$ guards. Apply after schema.sql:
--   psql -U monitor -d monitoring -f database/release_migration.sql
-- =====================================================================

-- ---------- enums (guarded; CREATE TYPE has no IF NOT EXISTS) ----------
DO $$ BEGIN
  CREATE TYPE vcs_provider AS ENUM ('github','gitlab','bitbucket');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE release_channel AS ENUM
    ('draft','canary','beta','production','enterprise','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE release_item_type AS ENUM ('feature','bug','hotfix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deploy_status AS ENUM
    ('pending','approved','in_progress','succeeded','failed','rolled_back');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ REPOSITORIES ============
CREATE TABLE IF NOT EXISTS repositories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,                 -- Master-BE
  slug                TEXT UNIQUE NOT NULL,
  provider            vcs_provider NOT NULL DEFAULT 'github',
  external_id         TEXT,                          -- provider repo id
  remote_url          TEXT NOT NULL,
  default_branch      TEXT NOT NULL DEFAULT 'main',
  tech_stack          TEXT[],                        -- {laravel,php} / {react,ts}
  docker_image_name   TEXT,                          -- storemate/master-be
  container_registry  TEXT,                          -- ghcr.io / ecr / dockerhub
  branch_protection   JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  last_synced_at      TIMESTAMPTZ,                   -- set by the Git sync stub
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repositories_product ON repositories (product_id);

-- ============ VERSIONS ============
CREATE TABLE IF NOT EXISTS repo_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,                       -- 1.7.0 (semver)
  major         INT NOT NULL DEFAULT 0,
  minor         INT NOT NULL DEFAULT 0,
  patch         INT NOT NULL DEFAULT 0,
  prerelease    TEXT,                                -- rc.1, beta.2
  commit_sha    TEXT,
  released_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, version)
);
CREATE INDEX IF NOT EXISTS idx_repo_versions_repo ON repo_versions (repository_id);

-- ============ RELEASES ============
CREATE TABLE IF NOT EXISTS releases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version       TEXT NOT NULL,                       -- platform-wide train, e.g. 1.7.0
  name          TEXT,
  status        release_channel NOT NULL DEFAULT 'draft',
  release_notes TEXT,                                -- generated markdown
  notes_artifact_url TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ,
  UNIQUE (version)
);

-- which repos + which exact commit are pinned in this release
CREATE TABLE IF NOT EXISTS release_repositories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  repository_id UUID NOT NULL REFERENCES repositories(id),
  repo_version  TEXT,                                -- 1.7.0
  commit_sha    TEXT NOT NULL,                       -- pinned SHA
  branch_name   TEXT,                                -- release/1.7.0
  UNIQUE (release_id, repository_id)
);
CREATE INDEX IF NOT EXISTS idx_release_repos_release ON release_repositories (release_id);

-- bundled changelog items (feature/bug/hotfix). Self-contained: stores the
-- human key + title so release-notes generation works without the full
-- feature/bug tracking module.
CREATE TABLE IF NOT EXISTS release_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  item_type   release_item_type NOT NULL,
  item_key    TEXT NOT NULL,                         -- FEAT-1042 / BUG-2207 / HF-0099
  title       TEXT NOT NULL,
  author      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, item_type, item_key)
);
CREATE INDEX IF NOT EXISTS idx_release_items_release ON release_items (release_id);

-- ============ DEPLOYMENTS & CHANNELS ============
CREATE TABLE IF NOT EXISTS channels (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key       release_channel NOT NULL,               -- canary|beta|production|enterprise
  name      TEXT NOT NULL,
  rank      INT NOT NULL,                            -- promotion order 1..4
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS deployments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id       UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  channel_id       UUID NOT NULL REFERENCES channels(id),
  status           deploy_status NOT NULL DEFAULT 'pending',
  current_version  TEXT,
  previous_version TEXT,
  rollback_target  TEXT,                             -- version to roll back to
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  triggered_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  logs_url         TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployments_release ON deployments (release_id);
CREATE INDEX IF NOT EXISTS idx_deployments_channel ON deployments (channel_id);

-- immutable audit trail of every deployment status transition
CREATE TABLE IF NOT EXISTS deployment_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  from_status   deploy_status,
  to_status     deploy_status NOT NULL,
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_history_dep ON deployment_history (deployment_id);

-- ---------- seed the standard promotion channels ----------
INSERT INTO channels (key, name, rank, requires_approval) VALUES
  ('canary',     'Canary',     1, true),
  ('beta',       'Beta',       2, true),
  ('production', 'Production', 3, true),
  ('enterprise', 'Enterprise', 4, true)
ON CONFLICT (key) DO NOTHING;
