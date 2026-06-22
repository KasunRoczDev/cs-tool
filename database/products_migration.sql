-- =====================================================================
-- Products — group servers by product (OMS, TransExpress, …).
-- Each server belongs to at most one product; environment (live/staging)
-- continues to live in servers.tags.env.
-- Apply after schema.sql:
--   psql -U monitor -d monitoring -f database/products_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link servers to a product. ON DELETE SET NULL so removing a product
-- leaves its servers intact (just unassigned).
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_servers_product ON servers (product_id);

-- Seed the products from the current deployment.
INSERT INTO products (name, description) VALUES
  ('OMS',         'Order Management System'),
  ('TransExpress','TransExpress')
ON CONFLICT (name) DO NOTHING;
