-- =====================================================================
-- Cybersecurity & Server Metrics Monitoring Platform
-- PostgreSQL + TimescaleDB schema
-- =====================================================================
-- Run against a fresh database. Requires the timescaledb extension.
--   psql -U monitor -d monitoring -f schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE server_status      AS ENUM ('online', 'offline', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_severity     AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alert_status       AS ENUM ('open', 'acknowledged', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role          AS ENUM ('admin', 'operator', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- USERS  (dashboard RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- SERVERS  (registered agents)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  hostname    TEXT,
  ip_address  INET,
  -- API key stored hashed (sha256 hex). Plaintext shown once at onboarding.
  api_key_hash TEXT UNIQUE NOT NULL,
  os          TEXT,
  tags        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      server_status NOT NULL DEFAULT 'unknown',
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_servers_status    ON servers (status);
CREATE INDEX IF NOT EXISTS idx_servers_last_seen ON servers (last_seen DESC);

-- ---------------------------------------------------------------------
-- METRICS  (time-series hypertable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metrics (
  server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  time         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cpu_usage    DOUBLE PRECISION,   -- percent 0-100
  memory_usage DOUBLE PRECISION,   -- percent 0-100
  disk_usage   DOUBLE PRECISION,   -- percent 0-100
  net_in       DOUBLE PRECISION,   -- bytes/sec
  net_out      DOUBLE PRECISION,   -- bytes/sec
  load_avg     DOUBLE PRECISION,
  extra        JSONB
);

SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_metrics_server_time ON metrics (server_id, time DESC);

-- ---------------------------------------------------------------------
-- SECURITY EVENTS  (time-series hypertable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type  TEXT NOT NULL,        -- ssh_failed_login | sudo | firewall_block | port_scan ...
  severity    event_severity NOT NULL DEFAULT 'low',
  source_ip   INET,
  username    TEXT,
  message     TEXT,
  raw         JSONB,
  PRIMARY KEY (id, time)
);

SELECT create_hypertable('security_events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_secevents_server_time ON security_events (server_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_secevents_type        ON security_events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_secevents_severity    ON security_events (severity, time DESC);

-- ---------------------------------------------------------------------
-- ALERTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID REFERENCES servers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,        -- cpu_high | mem_high | disk_full | offline | ssh_bruteforce ...
  severity    event_severity NOT NULL DEFAULT 'medium',
  threshold   DOUBLE PRECISION,
  value       DOUBLE PRECISION,
  message     TEXT,
  status      alert_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_server ON alerts (server_id, created_at DESC);
-- Prevent duplicate open alerts of the same type per server.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_alert
  ON alerts (server_id, type) WHERE status = 'open';

-- ---------------------------------------------------------------------
-- AUDIT LOG  (admin actions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- CONTINUOUS AGGREGATE  (1-minute rollup for fast dashboard charts)
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1m
WITH (timescaledb.continuous) AS
SELECT
  server_id,
  time_bucket('1 minute', time) AS bucket,
  avg(cpu_usage)    AS cpu_usage,
  avg(memory_usage) AS memory_usage,
  avg(disk_usage)   AS disk_usage,
  avg(net_in)       AS net_in,
  avg(net_out)      AS net_out
FROM metrics
GROUP BY server_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1m',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);

-- ---------------------------------------------------------------------
-- RETENTION POLICIES  (configurable; defaults below)
-- ---------------------------------------------------------------------
SELECT add_retention_policy('metrics',         INTERVAL '30 days',  if_not_exists => TRUE);
SELECT add_retention_policy('security_events', INTERVAL '180 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------
-- COMPRESSION  (saves space on older chunks)
-- ---------------------------------------------------------------------
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'server_id'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------
-- SEED  (default admin — CHANGE THE PASSWORD)
-- password = "admin123"  (bcrypt). Replace in production.
-- ---------------------------------------------------------------------
INSERT INTO users (email, password_hash, role)
VALUES ('admin@example.com',
        '$2b$10$wH8Qd0Qp1m6m4Yk9Q9b1uE4q8t3X5r2c0aZ7nF8lP6sV2dC1eG3K',
        'admin')
ON CONFLICT (email) DO NOTHING;
