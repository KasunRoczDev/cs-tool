-- =====================================================================
-- Advanced approval workflows: delegation, expiration, reminders, and a
-- real decision history (release_approvals itself upserts in place, so it
-- alone can't answer "what did this look like last week").
--
-- Deliberately NOT built: sequential/conditional gating (no product-level
-- definition of "what order" or "what condition" to key off yet) and digital
-- signatures (needs real PKI/signing infrastructure this platform doesn't
-- have — a checkbox labeled "signed" would be theater, not a signature).
--
-- Idempotent. Apply after release_approvals_migration.sql.
--   psql -U monitor -d monitoring -f database/approval_workflows_migration.sql
-- =====================================================================

-- Immutable audit trail — every decision change, expiry, reminder-triggered
-- reset, or admin re-request, independent of release_approvals' live upsert.
CREATE TABLE IF NOT EXISTS release_approval_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  approver_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_role TEXT NOT NULL,
  decision      TEXT NOT NULL,          -- approved | rejected | pending | expired
  remark        TEXT,
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL, -- who caused this row
  note          TEXT,                   -- e.g. "delegated by <email>", "expired after 14d", "re-requested"
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_history_release ON release_approval_history (release_id, occurred_at DESC);

-- While active, to_user may submit decisions on behalf of from_user.
CREATE TABLE IF NOT EXISTS approval_delegations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  reason      TEXT,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delegation_range CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_active ON approval_delegations (from_user, ends_at) WHERE revoked_at IS NULL;

-- Per-(release, approver) reminder cadence tracking — exists independent of
-- whether a decision row exists yet, since an approver who never acted has
-- no release_approvals row to hang this off.
CREATE TABLE IF NOT EXISTS approval_reminders (
  release_id       UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  approver_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_reminded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, approver_id)
);

ALTER TABLE release_approvals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE release_approvals ADD COLUMN IF NOT EXISTS decided_on_behalf_of UUID REFERENCES users(id) ON DELETE SET NULL;
