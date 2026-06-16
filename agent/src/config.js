'use strict';
const fs = require('fs');
const yaml = require('js-yaml');

const DEFAULTS = {
  server_url: 'http://localhost:4000',
  api_key: '',
  metrics_interval: 15,
  send_interval: 30,
  metrics: true,
  security_logs: true,
  tls_verify: true,
  buffer_file: '/var/lib/monitor-agent/buffer.ndjson',
  buffer_max_items: 50000,
  auth_log: '/var/log/auth.log',
  use_journald: true,
};

function loadConfig(path) {
  let fileCfg = {};
  try {
    fileCfg = yaml.load(fs.readFileSync(path, 'utf8')) || {};
  } catch (e) {
    console.warn(`[config] could not read ${path}: ${e.message} (using defaults/env)`);
  }
  const cfg = { ...DEFAULTS, ...fileCfg };

  // Environment overrides (handy for containers)
  if (process.env.MONITOR_SERVER_URL) cfg.server_url = process.env.MONITOR_SERVER_URL;
  if (process.env.MONITOR_API_KEY) cfg.api_key = process.env.MONITOR_API_KEY;

  if (!cfg.api_key) {
    throw new Error('api_key is required (set in config file or MONITOR_API_KEY)');
  }
  return cfg;
}

module.exports = { loadConfig, DEFAULTS };
