-- =====================================================================
-- Platform settings — generic key/value store for admin-configurable
-- options (SMTP credentials, etc.).
-- Apply after schema.sql:
--   psql -U monitor -d monitoring -f database/settings_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,           -- stored as text; JSON values are JSON-encoded strings
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default (empty) SMTP rows so the UI can show them immediately.
INSERT INTO platform_settings (key, value) VALUES
  ('smtp_host',   ''),
  ('smtp_port',   '587'),
  ('smtp_secure', 'false'),
  ('smtp_user',   ''),
  ('smtp_pass',   ''),
  ('smtp_from',   '')
ON CONFLICT (key) DO NOTHING;
