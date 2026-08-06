-- =====================================================================
-- Seeds default spec_fields for the built-in service types, so a fresh
-- install gets sensible Specs auto-fill out of the box instead of empty
-- lists. Idempotent: only touches rows still at the '[]' default, so it
-- never clobbers spec_fields an admin has already customized.
-- Apply after service_type_spec_fields_migration.sql (column must exist).
--   psql -U monitor -d monitoring -f database/service_type_default_spec_fields_migration.sql
-- =====================================================================

UPDATE service_types SET spec_fields = '["vCPU", "RAM (GB)", "Disk (GB)"]'::jsonb
  WHERE key = 'ecs' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Engine", "Engine Version", "Storage (GB)", "Instance Class"]'::jsonb
  WHERE key = 'rds' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Engine Version", "Storage (GB)", "Instance Class"]'::jsonb
  WHERE key = 'rds_mysql' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Engine Version", "Storage (GB)", "Instance Class"]'::jsonb
  WHERE key = 'rds_pgsql' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Storage Class", "Capacity (GB)", "Requests (per month)"]'::jsonb
  WHERE key = 'obs' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Storage Type", "Capacity (GB)", "IOPS"]'::jsonb
  WHERE key = 'storage' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Node Type", "Memory (GB)", "Cluster Mode"]'::jsonb
  WHERE key = 'redis' AND spec_fields = '[]'::jsonb;

UPDATE service_types SET spec_fields = '["Bandwidth (Mbps)", "Traffic (GB)", "Domain"]'::jsonb
  WHERE key = 'cdn' AND spec_fields = '[]'::jsonb;
