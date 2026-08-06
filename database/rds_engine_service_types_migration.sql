-- =====================================================================
-- Adds engine-specific RDS service types (MySQL / PostgreSQL) alongside
-- the generic "RDS" type seeded in billing_migration.sql, so billing can
-- be grouped/reported by exact database engine.
-- Apply after billing_migration.sql (service_types must already exist).
--   psql -U monitor -d monitoring -f database/rds_engine_service_types_migration.sql
-- =====================================================================

INSERT INTO service_types (key, name) VALUES
  ('rds_mysql', 'RDS MySQL'),
  ('rds_pgsql', 'RDS PostgreSQL')
ON CONFLICT (key) DO NOTHING;
