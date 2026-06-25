-- ---------------------------------------------------------------------
-- TOPOLOGY  (per product + environment network graph)
-- ---------------------------------------------------------------------
-- Stores an editable infrastructure relation graph for each product, split
-- by environment (dev / qa / staging / production). The whole canvas — nodes
-- (ip, load balancer, server, db, client, firewall) and edges (relations) —
-- is kept as a single JSONB document so the editor can save/restore it in one
-- round trip.
--
-- graph shape:
--   { "nodes": [ { id, type, label, ip, x, y } ],
--     "edges": [ { id, from, to, label } ] }
--
-- Idempotent: safe to run on every migrate (IF NOT EXISTS / no destructive ops).

CREATE TABLE IF NOT EXISTS topologies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  environment TEXT NOT NULL
                CHECK (environment IN ('dev', 'qa', 'staging', 'production')),
  graph       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  -- One graph per product per environment.
  UNIQUE (product_id, environment)
);

CREATE INDEX IF NOT EXISTS idx_topologies_product ON topologies (product_id);
