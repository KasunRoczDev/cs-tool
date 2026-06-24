-- =====================================================================
-- Email Notifications: channels + rules
-- Apply after schema.sql:
--   psql -U monitor -d monitoring -f database/notifications_migration.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- NOTIFICATION CHANNELS  (one row per configured email destination)
-- A channel holds connection config (JSONB).
-- Multiple channels can be created; each can have independent rules.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                   -- user-facing label, e.g. "Ops team email"
  type        TEXT NOT NULL DEFAULT 'email',   -- 'email' | 'discord' (extensible to slack, webhook, …)
  config      JSONB NOT NULL DEFAULT '{}',     -- email: { "to","cc","subject_prefix" } · discord: { "webhook_url","username" }
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_channels_enabled ON notification_channels (enabled);

-- ---------------------------------------------------------------------
-- NOTIFICATION RULES  (conditions that trigger a channel)
-- NULL in a filter column means "match all values".
-- Multiple rules can point at the same channel; ALL matching rules fire.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  -- Scope filters (NULL = match everything)
  server_id   UUID REFERENCES servers(id) ON DELETE CASCADE,  -- NULL = all servers
  alert_type  TEXT,          -- NULL = all types  (cpu_high, mem_high, offline, …)
  severities  TEXT[] NOT NULL DEFAULT ARRAY['low','medium','high','critical'],
  -- When to fire
  on_open     BOOLEAN NOT NULL DEFAULT TRUE,   -- fire when alert opens
  on_resolve  BOOLEAN NOT NULL DEFAULT FALSE,  -- fire when alert resolves
  -- Cool-down: skip if the same channel+alert was notified within N minutes
  cooldown_minutes INT NOT NULL DEFAULT 30,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_rules_channel  ON notification_rules (channel_id);
CREATE INDEX IF NOT EXISTS idx_notif_rules_server   ON notification_rules (server_id);
CREATE INDEX IF NOT EXISTS idx_notif_rules_enabled  ON notification_rules (enabled);

-- ---------------------------------------------------------------------
-- NOTIFICATION LOG  (delivery history, dedup & cool-down source-of-truth)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
  channel_id  UUID REFERENCES notification_channels(id) ON DELETE SET NULL,
  alert_id    UUID REFERENCES alerts(id) ON DELETE SET NULL,
  server_id   UUID REFERENCES servers(id) ON DELETE SET NULL,
  alert_type  TEXT,
  event       TEXT NOT NULL,   -- 'open' | 'resolve'
  status      TEXT NOT NULL,   -- 'sent' | 'failed' | 'suppressed'
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_rule_alert ON notification_log (rule_id, alert_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_sent_at    ON notification_log (sent_at DESC);
