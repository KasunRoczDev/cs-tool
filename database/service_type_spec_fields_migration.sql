-- =====================================================================
-- Adds a declared set of spec field names per Service Type (e.g. ECS ->
-- ["vCPU", "RAM (GB)", "Disk (GB)"]), so the Services form can auto-fill
-- the Specs section when a type is selected instead of starting blank.
-- Apply after billing_migration.sql (service_types must already exist).
--   psql -U monitor -d monitoring -f database/service_type_spec_fields_migration.sql
-- =====================================================================

ALTER TABLE service_types
  ADD COLUMN IF NOT EXISTS spec_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
