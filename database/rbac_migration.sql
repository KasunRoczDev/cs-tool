-- =====================================================================
-- Product-wise RBAC + Release Status state machine.
-- Apply after schema.sql, products_migration.sql, release_migration.sql,
-- release_approvals_migration.sql.  Idempotent (IF NOT EXISTS / ON CONFLICT).
--   psql -U monitor -d monitoring -f database/rbac_migration.sql
-- =====================================================================

-- ---------------- RBAC ----------------
CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,
  description TEXT,
  resource    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT false,
  approval_slot TEXT,                         -- qa|ba|dev_lead|tech_lead|null
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'product',   -- global | product
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (user_id, role_id, scope_type, product_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user    ON memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_product ON memberships (product_id);

-- ---------------- Release status state machine ----------------
CREATE TABLE IF NOT EXISTS release_workflows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,   -- null = default
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);

CREATE TABLE IF NOT EXISTS release_statuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES release_workflows(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  rank        INT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'stage',   -- draft|stage|terminal
  channel_key TEXT,
  color       TEXT,
  UNIQUE (workflow_id, key)
);

CREATE TABLE IF NOT EXISTS release_transitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    UUID NOT NULL REFERENCES release_workflows(id) ON DELETE CASCADE,
  from_status_id UUID REFERENCES release_statuses(id) ON DELETE CASCADE,  -- null = from any
  to_status_id   UUID NOT NULL REFERENCES release_statuses(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'forward',   -- forward|rollback|archive
  require_approval    BOOLEAN NOT NULL DEFAULT true,
  required_checks     TEXT[] NOT NULL DEFAULT '{}',
  required_permission TEXT,
  auto_deploy    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (workflow_id, from_status_id, to_status_id)
);

ALTER TABLE releases ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES release_statuses(id);

CREATE TABLE IF NOT EXISTS release_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  from_status_id  UUID REFERENCES release_statuses(id),
  to_status_id    UUID NOT NULL REFERENCES release_statuses(id),
  transition_id   UUID REFERENCES release_transitions(id),
  actor_id        UUID REFERENCES users(id),
  note            TEXT,
  checks_snapshot JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_history_release ON release_status_history (release_id, created_at DESC);

-- ============ SEED: permissions ============
INSERT INTO permissions (key, resource, description) VALUES
  ('product.read','product','View products'),
  ('product.manage','product','Create/edit products'),
  ('member.manage','member','Manage product members'),
  ('role.manage','role','Manage roles & permissions'),
  ('permission.read','permission','View permission catalog'),
  ('repository.read','repository','View repositories'),
  ('repository.manage','repository','Manage repositories'),
  ('branch.create','branch','Create branches'),
  ('branch.delete','branch','Delete branches'),
  ('branch.merge','branch','Merge branches'),
  ('workitem.read','workitem','View work items'),
  ('workitem.create','workitem','Create work items'),
  ('workitem.verify','workitem','Verify work items'),
  ('release.read','release','View releases'),
  ('release.create','release','Create releases'),
  ('release.edit','release','Edit releases'),
  ('release.attach_repo','release','Pin repos to releases'),
  ('release.generate_notes','release','Generate release notes'),
  ('release.archive','release','Archive releases'),
  ('release.promote','release','Promote release (any allowed forward transition)'),
  ('status.transition.canary','status','Transition release to Canary'),
  ('status.transition.beta','status','Transition release to Beta'),
  ('status.transition.production','status','Transition release to Production'),
  ('status.transition.enterprise','status','Transition release to Enterprise'),
  ('status.transition.archived','status','Archive release'),
  ('approval.submit','approval','Submit an approval decision'),
  ('approval.override','approval','Bypass the approval gate'),
  ('deploy.execute.canary','deploy','Deploy to Canary'),
  ('deploy.execute.beta','deploy','Deploy to Beta'),
  ('deploy.execute.production','deploy','Deploy to Production'),
  ('deploy.execute.enterprise','deploy','Deploy to Enterprise'),
  ('deploy.approve.canary','deploy','Approve Canary deploy'),
  ('deploy.approve.beta','deploy','Approve Beta deploy'),
  ('deploy.approve.production','deploy','Approve Production deploy'),
  ('deploy.approve.enterprise','deploy','Approve Enterprise deploy'),
  ('deploy.rollback','deploy','Roll back a deployment'),
  ('audit.read','audit','View audit logs'),
  ('settings.manage','settings','Manage platform settings & workflows'),
  ('notification.manage','notification','Manage notification channels'),
  ('ai.use','ai','Use the AI assistant')
ON CONFLICT (key) DO NOTHING;

-- ============ SEED: system roles ============
INSERT INTO roles (key, name, description, is_system, approval_slot) VALUES
  ('platform_admin','Platform Admin','Global superuser', true, NULL),
  ('product_admin','Product Admin','Owns a product', true, NULL),
  ('release_manager','Release Manager','Drives releases', true, NULL),
  ('devops','DevOps','Runs deployments', true, NULL),
  ('developer','Developer','Builds features', true, 'dev_lead'),
  ('qa','QA','Quality sign-off', true, 'qa'),
  ('ba','BA','Business sign-off', true, 'ba'),
  ('tech_lead','Tech Lead','Technical sign-off', true, 'tech_lead'),
  ('viewer','Viewer','Read only', true, NULL)
ON CONFLICT (key) DO NOTHING;

-- platform_admin gets everything
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p.key FROM roles r CROSS JOIN permissions p WHERE r.key='platform_admin'
ON CONFLICT DO NOTHING;

-- product_admin: everything except platform-global settings/roles
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p.key FROM roles r CROSS JOIN permissions p
   WHERE r.key='product_admin' AND p.key NOT IN ('role.manage','settings.manage')
ON CONFLICT DO NOTHING;

-- helper: grant a set to a role by key
-- release_manager
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY[
    'release.read','release.create','release.edit','release.attach_repo','release.generate_notes',
    'release.archive','release.promote','status.transition.canary','status.transition.beta',
    'status.transition.production','status.transition.enterprise','status.transition.archived',
    'deploy.approve.canary','deploy.approve.beta','deploy.approve.production','deploy.approve.enterprise',
    'deploy.rollback','approval.override','repository.read','workitem.read','audit.read'
  ]) AS k WHERE r.key='release_manager'
ON CONFLICT DO NOTHING;

-- devops
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY[
    'release.read','repository.read','repository.manage','branch.create','branch.delete','branch.merge',
    'deploy.execute.canary','deploy.execute.beta','deploy.execute.production','deploy.execute.enterprise',
    'deploy.rollback','workitem.read'
  ]) AS k WHERE r.key='devops'
ON CONFLICT DO NOTHING;

-- developer
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY[
    'release.read','repository.read','branch.create','branch.merge','workitem.read','workitem.create',
    'release.attach_repo','approval.submit'
  ]) AS k WHERE r.key='developer'
ON CONFLICT DO NOTHING;

-- qa / ba
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY['release.read','workitem.read','workitem.verify','approval.submit']) AS k
   WHERE r.key='qa'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY['release.read','approval.submit']) AS k WHERE r.key='ba'
ON CONFLICT DO NOTHING;

-- tech_lead
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, k FROM roles r, unnest(ARRAY[
    'release.read','repository.read','approval.submit','status.transition.canary','status.transition.beta'
  ]) AS k WHERE r.key='tech_lead'
ON CONFLICT DO NOTHING;

-- viewer: all *.read
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p.key FROM roles r CROSS JOIN permissions p
   WHERE r.key='viewer' AND p.key LIKE '%.read'
ON CONFLICT DO NOTHING;

-- ============ BACKFILL: memberships from legacy users.role/approval_role ============
-- admins -> global platform_admin
INSERT INTO memberships (user_id, role_id, scope_type, product_id)
  SELECT u.id, r.id, 'global', NULL FROM users u CROSS JOIN roles r
   WHERE u.role='admin' AND r.key='platform_admin'
ON CONFLICT DO NOTHING;
-- operators -> devops (global if no product, else product-scoped)
INSERT INTO memberships (user_id, role_id, scope_type, product_id)
  SELECT u.id, r.id, CASE WHEN u.product_id IS NULL THEN 'global' ELSE 'product' END, u.product_id
    FROM users u CROSS JOIN roles r WHERE u.role='operator' AND r.key='devops'
ON CONFLICT DO NOTHING;
-- viewers -> global viewer
INSERT INTO memberships (user_id, role_id, scope_type, product_id)
  SELECT u.id, r.id, 'global', NULL FROM users u CROSS JOIN roles r
   WHERE u.role='viewer' AND r.key='viewer'
ON CONFLICT DO NOTHING;
-- approval roles -> matching role on their product
INSERT INTO memberships (user_id, role_id, scope_type, product_id)
  SELECT u.id, r.id, 'product', u.product_id
    FROM users u JOIN roles r ON r.key = u.approval_role
   WHERE u.approval_role IS NOT NULL AND u.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============ SEED: default release workflow ============
INSERT INTO release_workflows (name, product_id, is_default)
  VALUES ('Default', NULL, true)
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO release_statuses (workflow_id, key, name, rank, category, channel_key, color)
  SELECT w.id, s.key, s.name, s.rank, s.category, s.channel_key, s.color
    FROM release_workflows w,
    (VALUES
      ('draft','Draft',0,'draft',NULL,'#64748b'),
      ('canary','Canary',1,'stage','canary','#eab308'),
      ('beta','Beta',2,'stage','beta','#3b82f6'),
      ('production','Production',3,'stage','production','#22c55e'),
      ('enterprise','Enterprise',4,'stage','enterprise','#a855f7'),
      ('archived','Archived',5,'terminal',NULL,'#6b7280')
    ) AS s(key,name,rank,category,channel_key,color)
   WHERE w.is_default = true
ON CONFLICT (workflow_id, key) DO NOTHING;

-- Forward transitions between consecutive statuses + archive-from-any.
INSERT INTO release_transitions (workflow_id, from_status_id, to_status_id, kind, require_approval, required_permission)
  SELECT w.id, sf.id, st.id, 'forward', true, 'status.transition.'||st.key
    FROM release_workflows w
    JOIN release_statuses sf ON sf.workflow_id = w.id
    JOIN release_statuses st ON st.workflow_id = w.id AND st.rank = sf.rank + 1 AND st.key <> 'archived'
   WHERE w.is_default = true
ON CONFLICT DO NOTHING;

INSERT INTO release_transitions (workflow_id, from_status_id, to_status_id, kind, require_approval, required_permission)
  SELECT w.id, NULL, st.id, 'archive', false, 'status.transition.archived'
    FROM release_workflows w JOIN release_statuses st ON st.workflow_id = w.id AND st.key='archived'
   WHERE w.is_default = true
ON CONFLICT DO NOTHING;

-- Point existing releases at the matching default status (best-effort by key).
UPDATE releases r SET status_id = s.id
  FROM release_statuses s
  JOIN release_workflows w ON w.id = s.workflow_id AND w.is_default = true
 WHERE r.status_id IS NULL AND s.key = r.status::text;
