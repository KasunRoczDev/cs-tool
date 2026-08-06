-- =====================================================================
-- Apps directory: which apps run on which monitored server, per-server
-- nginx/php-fpm/php.ini config, and app-scoped (optionally channel-
-- scoped) environment variables/secrets.
-- Apply after release_migration.sql (repositories, products, channels)
-- and environment_secrets_migration.sql (crypto pattern precedent).
--   psql -U monitor -d monitoring -f database/apps_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS apps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_product ON apps (product_id);
CREATE INDEX IF NOT EXISTS idx_apps_repository ON apps (repository_id);

CREATE TABLE IF NOT EXISTS server_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  app_id          UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  nginx_config    TEXT,
  php_fpm_config  TEXT,
  php_ini_config  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, app_id)
);
CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps (server_id);
CREATE INDEX IF NOT EXISTS idx_server_apps_app ON server_apps (app_id);

CREATE TABLE IF NOT EXISTS app_env_vars (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  channel_id  UUID REFERENCES channels(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value_enc   TEXT,
  value_plain TEXT,
  is_secret   BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, channel_id, key)
);
CREATE INDEX IF NOT EXISTS idx_app_env_vars_app ON app_env_vars (app_id);
