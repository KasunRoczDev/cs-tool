-- =====================================================================
-- Release Approvals: multi-role sign-off (QA / BA / DEV Lead / Tech Lead)
-- Apply after release_migration.sql (releases) + products_migration.sql.
--   psql -U monitor -d monitoring -f database/release_approvals_migration.sql
-- =====================================================================

-- Approvers are users with an approval_role assigned to a product. A release
-- (scoped to its repos' product) must be approved by EVERY such user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_role TEXT;          -- qa | ba | dev_lead | tech_lead
ALTER TABLE users ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_approval ON users (product_id, approval_role) WHERE approval_role IS NOT NULL;

CREATE TABLE IF NOT EXISTS release_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  approver_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approval_role TEXT NOT NULL,                 -- snapshot of the approver's role
  decision      TEXT NOT NULL DEFAULT 'approved', -- approved | rejected
  remark        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, approver_id)             -- one decision per approver (re-submittable)
);
CREATE INDEX IF NOT EXISTS idx_release_approvals_release ON release_approvals (release_id);

-- Attachments uploaded with an approval (screenshots, sign-off docs). Stored in
-- the DB as bytea — fine for small evidence files.
CREATE TABLE IF NOT EXISTS release_approval_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id  UUID NOT NULL REFERENCES release_approvals(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT,
  size         INTEGER,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_attachments ON release_approval_attachments (approval_id);
