-- =====================================================================
-- Adds an optional cloud provider label per service (AWS, Azure, Huawei
-- Cloud, DigitalOcean, ...), so services/billing can be filtered by
-- provider in addition to project/type. Free text (like region) rather
-- than an enum, since the set of providers can grow.
-- Apply after billing_migration.sql (services must already exist).
--   psql -U monitor -d monitoring -f database/service_provider_migration.sql
-- =====================================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS provider TEXT;
CREATE INDEX IF NOT EXISTS idx_services_provider ON services (provider);
