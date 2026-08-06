-- =====================================================================
-- Billing Management — service inventory + monthly billing records.
-- Apply after schema.sql, products_migration.sql, settings_migration.sql.
--   psql -U monitor -d monitoring -f database/billing_migration.sql
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE billing_mode AS ENUM ('pay_per_use', 'monthly', 'annual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE service_status AS ENUM ('active', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS service_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  name            TEXT NOT NULL,
  region          TEXT,
  specs           JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_mode    billing_mode NOT NULL DEFAULT 'monthly',
  server_id       UUID REFERENCES servers(id) ON DELETE SET NULL,
  tags            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          service_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_services_product ON services (product_id);
CREATE INDEX IF NOT EXISTS idx_services_type    ON services (service_type_id);
CREATE INDEX IF NOT EXISTS idx_services_server  ON services (server_id);

CREATE TABLE IF NOT EXISTS billing_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, billing_month)
);
CREATE INDEX IF NOT EXISTS idx_billing_records_month ON billing_records (billing_month DESC);

INSERT INTO service_types (key, name) VALUES
  ('ecs', 'ECS'), ('rds', 'RDS'), ('obs', 'OBS'),
  ('storage', 'Storage'), ('redis', 'Redis')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES ('billing_currency', 'USD')
ON CONFLICT (key) DO NOTHING;
