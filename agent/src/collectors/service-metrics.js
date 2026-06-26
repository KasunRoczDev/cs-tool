'use strict';
// Service / application metrics — the 12 signals that tell you whether the
// *stack* (not just the host) is healthy. Rides the security-events path as a
// single `service_metrics_snapshot` event with every value under `raw`, exactly
// like metrics-extended.js — so no schema change and it flows through the
// existing /api/v1/security-events ingestion untouched.
//
//   const { collectServiceMetricsAsEvent } = require('./collectors/service-metrics');
//   sender.enqueueEvent(await collectServiceMetricsAsEvent(cfg));
//
// Every probe is best-effort: if the source isn't configured or reachable the
// field is null and the snapshot still ships. Config lives under cfg.service_metrics
// (see agent.example.yaml). External CLIs used when present: psql, redis-cli,
// docker, openssl, journalctl — none are hard dependencies.

const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

// ── tiny shell helper: returns trimmed stdout, or null on any failure ───────
function sh(cmd, timeout = 6000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function round(v, p = 2) {
  if (v == null || !isFinite(v)) return null;
  const f = Math.pow(10, p);
  return Math.round(v * f) / f;
}

// ── GET JSON over http/https with a short timeout ───────────────────────────
function getJson(url, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

const DAY = 86400;

// ── 1. Load average (host) — load1 and per-core normalisation ───────────────
function loadAverage() {
  try {
    const [l1] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number);
    const cores = os.cpus().length || 1;
    return { load_avg_1: round(l1), load_per_core: round(l1 / cores), cores };
  } catch {
    return { load_avg_1: null, load_per_core: null, cores: null };
  }
}

// ── 2/3. API p95 latency + error rate ───────────────────────────────────────
// Preferred: a JSON metrics endpoint returning any of { p95_ms, error_rate,
// requests, errors }. Fallback: parse an nginx access log whose log_format ends
// with `$status ... $request_time` (or `rt=<sec>`), over the last N lines.
async function apiMetrics(api) {
  if (!api) return { api_p95_ms: null, api_error_rate: null };
  if (api.metrics_url) {
    const j = await getJson(api.metrics_url);
    if (j) {
      let p95 = num(j.p95_ms ?? j.p95 ?? j.latency_p95_ms);
      let err = num(j.error_rate);
      const req = num(j.requests);
      const errs = num(j.errors);
      if (err == null && req != null && req > 0 && errs != null) err = (errs / req) * 100;
      if (err != null && err <= 1) err = err * 100; // accept 0-1 fractions
      return { api_p95_ms: round(p95), api_error_rate: round(err) };
    }
  }
  if (api.access_log && fs.existsSync(api.access_log)) {
    try {
      const n = api.window_lines || 2000;
      const out = sh(`tail -n ${n} ${shellArg(api.access_log)}`, 5000) || '';
      const times = [];
      let total = 0, errors = 0;
      for (const line of out.split('\n')) {
        if (!line) continue;
        total += 1;
        const status = line.match(/"\s(\d{3})\s/) || line.match(/\s(\d{3})\s\d+\s/);
        if (status && Number(status[1]) >= 500) errors += 1;
        const rt = line.match(/rt=([\d.]+)/) || line.match(/\s([\d.]+)$/);
        if (rt) times.push(Number(rt[1]) * 1000); // seconds → ms
      }
      const p95 = percentile(times, 95);
      return {
        api_p95_ms: round(p95),
        api_error_rate: total ? round((errors / total) * 100) : null,
      };
    } catch { /* fallthrough */ }
  }
  return { api_p95_ms: null, api_error_rate: null };
}

// ── 4/5. PostgreSQL connections + slow (long-running active) queries ────────
function postgres(pg) {
  if (!pg || !pg.url) return { pg_connections: null, pg_connections_pct: null, pg_slow_queries: null };
  const q = (sql) => sh(`psql ${shellArg(pg.url)} -tAc ${shellArg(sql)}`, 8000);
  const conns = num(q('SELECT count(*) FROM pg_stat_activity'));
  const max = num(q('SELECT setting::int FROM pg_settings WHERE name = $$max_connections$$'));
  const slowMs = pg.slow_ms || 1000;
  const slow = num(q(
    `SELECT count(*) FROM pg_stat_activity ` +
    `WHERE state = $$active$$ AND now() - query_start > interval '${slowMs} milliseconds'`,
  ));
  return {
    pg_connections: conns,
    pg_connections_pct: conns != null && max ? round((conns / max) * 100) : null,
    pg_slow_queries: slow,
  };
}

// ── 6. Redis memory usage ───────────────────────────────────────────────────
function redisInfo(redis) {
  if (!redis || (!redis.url && !redis.host)) return null;
  const target = redis.url
    ? `-u ${shellArg(redis.url)}`
    : `-h ${shellArg(redis.host)} -p ${redis.port || 6379}` + (redis.password ? ` -a ${shellArg(redis.password)}` : '');
  const out = sh(`redis-cli ${target} info memory`, 6000);
  if (!out) return null;
  const get = (k) => { const m = out.match(new RegExp(`${k}:(\\d+)`)); return m ? Number(m[1]) : null; };
  return { used: get('used_memory'), max: get('maxmemory'), target };
}

function redisMemory(redis, info) {
  if (!info) return { redis_memory_mb: null, redis_memory_pct: null };
  const usedMb = info.used != null ? info.used / 1048576 : null;
  const maxBytes = info.max || (redis.maxmemory_mb ? redis.maxmemory_mb * 1048576 : 0);
  return {
    redis_memory_mb: round(usedMb, 1),
    redis_memory_pct: usedMb != null && maxBytes ? round((info.used / maxBytes) * 100) : null,
  };
}

// ── 7/8. BullMQ pending + failed jobs (BullMQ stores its state in Redis) ─────
// pending = waiting (LIST) + delayed (ZSET) + prioritized (ZSET); failed = ZSET.
function bullmq(bull, redis, info) {
  if (!bull || !bull.queues || !bull.queues.length || !info) {
    return { bullmq_pending: null, bullmq_failed: null };
  }
  const prefix = bull.prefix || 'bull';
  let pending = 0, failed = 0, ok = false;
  for (const q of bull.queues) {
    const llen = (k) => num(sh(`redis-cli ${info.target} llen ${shellArg(k)}`, 4000));
    const zcard = (k) => num(sh(`redis-cli ${info.target} zcard ${shellArg(k)}`, 4000));
    const wait = llen(`${prefix}:${q}:wait`);
    const delayed = zcard(`${prefix}:${q}:delayed`);
    const prioritized = zcard(`${prefix}:${q}:prioritized`);
    const fail = zcard(`${prefix}:${q}:failed`);
    if ([wait, delayed, prioritized, fail].some((v) => v != null)) ok = true;
    pending += (wait || 0) + (delayed || 0) + (prioritized || 0);
    failed += (fail || 0);
  }
  return ok ? { bullmq_pending: pending, bullmq_failed: failed } : { bullmq_pending: null, bullmq_failed: null };
}

// ── 9. Docker restart count — sum of RestartCount across running containers ──
function dockerRestarts(docker) {
  if (!docker || !docker.enabled) return { docker_restart_count: null };
  const ids = sh('docker ps -q', 6000);
  if (ids == null) return { docker_restart_count: null };
  if (!ids) return { docker_restart_count: 0 };
  const counts = sh(`docker inspect --format '{{.RestartCount}}' ${ids.split('\n').join(' ')}`, 8000);
  if (counts == null) return { docker_restart_count: null };
  const total = counts.split('\n').reduce((s, x) => s + (Number(x) || 0), 0);
  return { docker_restart_count: total };
}

// ── 10. SSL expiry days — minimum runway across all configured TLS targets ──
function sslExpiry(targets) {
  if (!targets || !targets.length) return { ssl_expiry_days: null, ssl_expiry_target: null };
  let minDays = null, which = null;
  for (const t of targets) {
    const [host, port = '443'] = String(t).split(':');
    const out = sh(
      `echo | timeout 8 openssl s_client -servername ${shellArg(host)} -connect ${shellArg(host + ':' + port)} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
      10000,
    );
    const m = out && out.match(/notAfter=(.+)/);
    if (!m) continue;
    const days = Math.round((new Date(m[1].trim()).getTime() - Date.now()) / 1000 / DAY);
    if (minDays == null || days < minDays) { minDays = days; which = t; }
  }
  return { ssl_expiry_days: minDays, ssl_expiry_target: which };
}

// ── 11. Failed SSH attempts in the recent window ────────────────────────────
function failedSsh(cfg, sm) {
  const win = sm.ssh_window_sec || 300;
  // journalctl is the most reliable source on modern Ubuntu; fall back to auth.log.
  if (cfg.use_journald) {
    const since = `${Math.ceil(win)} seconds ago`;
    const out = sh(`journalctl -u ssh -u sshd --since ${shellArg(since)} --no-pager 2>/dev/null | grep -c "Failed password"`, 8000);
    if (out != null) return { failed_ssh_attempts: Number(out) || 0 };
  }
  const log = cfg.auth_log || '/var/log/auth.log';
  if (fs.existsSync(log)) {
    const out = sh(`grep -c "Failed password" ${shellArg(log)}`, 6000);
    if (out != null) return { failed_ssh_attempts: Number(out) || 0, ssh_window_note: 'whole-file count' };
  }
  return { failed_ssh_attempts: null };
}

// ── 12. Order processing success rate (business KPI) ────────────────────────
// JSON endpoint { success, total } or { rate }, OR a SQL query returning one row
// "success total". Rate is a 0-100 percentage.
async function orderSuccess(orders) {
  if (!orders) return { order_success_rate: null };
  if (orders.metrics_url) {
    const j = await getJson(orders.metrics_url);
    if (j) {
      if (j.rate != null) { let r = num(j.rate); if (r != null && r <= 1) r *= 100; return { order_success_rate: round(r) }; }
      const s = num(j.success), t = num(j.total);
      if (s != null && t) return { order_success_rate: round((s / t) * 100) };
    }
  }
  if (orders.pg_url && orders.query) {
    const out = sh(`psql ${shellArg(orders.pg_url)} -tAc ${shellArg(orders.query)}`, 8000);
    if (out) {
      const parts = out.split(/[|\s]+/).map(Number).filter((x) => isFinite(x));
      if (parts.length >= 2 && parts[1]) return { order_success_rate: round((parts[0] / parts[1]) * 100) };
      if (parts.length === 1) return { order_success_rate: round(parts[0]) };
    }
  }
  return { order_success_rate: null };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function num(v) { if (v == null) return null; const n = Number(String(v).trim()); return isFinite(n) ? n : null; }
function percentile(arr, p) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
}
// Single-quote shell escaping so user-supplied values can't break out.
function shellArg(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// ── threshold evaluation → severity + human flags ───────────────────────────
function defaultThresholds(t = {}) {
  return {
    load_per_core:       t.load_per_core       ?? { warn: 1.0,  crit: 2.0 },
    api_p95_ms:          t.api_p95_ms           ?? { warn: 1000, crit: 3000 },
    api_error_rate:      t.api_error_rate       ?? { warn: 1,    crit: 5 },
    pg_connections_pct:  t.pg_connections_pct   ?? { warn: 80,   crit: 95 },
    pg_slow_queries:     t.pg_slow_queries      ?? { warn: 1,    crit: 10 },
    redis_memory_pct:    t.redis_memory_pct     ?? { warn: 80,   crit: 95 },
    bullmq_pending:      t.bullmq_pending       ?? { warn: 1000, crit: 10000 },
    bullmq_failed:       t.bullmq_failed        ?? { warn: 1,    crit: 50 },
    docker_restart_count:t.docker_restart_count ?? { warn: 3,    crit: 10 },
    ssl_expiry_days:     t.ssl_expiry_days      ?? { warn: 14,   crit: 7,  invert: true },
    failed_ssh_attempts: t.failed_ssh_attempts  ?? { warn: 10,   crit: 50 },
    order_success_rate:  t.order_success_rate   ?? { warn: 99,   crit: 95, invert: true },
  };
}

function evaluate(raw, thresholds) {
  const flags = [];
  let worst = 'info';
  const bump = (sev) => {
    const order = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(sev) > order.indexOf(worst)) worst = sev;
  };
  for (const [key, th] of Object.entries(thresholds)) {
    const v = raw[key];
    if (v == null) continue;
    const breach = th.invert ? (v <= th.crit ? 'crit' : v <= th.warn ? 'warn' : null)
                             : (v >= th.crit ? 'crit' : v >= th.warn ? 'warn' : null);
    if (!breach) continue;
    flags.push(`${key}=${v}`);
    bump(breach === 'crit' ? 'critical' : 'medium');
  }
  return { severity: worst, flags };
}

// ── public: collect everything and wrap as one snapshot event ───────────────
async function collectServiceMetricsAsEvent(cfg) {
  const sm = (cfg && cfg.service_metrics) || {};
  const info = redisInfo(sm.redis);

  const [api, orders] = await Promise.all([
    apiMetrics(sm.api),
    orderSuccess(sm.orders),
  ]);

  const raw = {
    timestamp: new Date().toISOString(),
    ...loadAverage(),
    ...api,
    ...postgres(sm.postgres),
    ...redisMemory(sm.redis || {}, info),
    ...bullmq(sm.bullmq, sm.redis, info),
    ...dockerRestarts(sm.docker),
    ...sslExpiry(sm.tls_targets),
    ...failedSsh(cfg, sm),
    ...orders,
  };

  const { severity, flags } = evaluate(raw, defaultThresholds(sm.thresholds));
  return {
    timestamp: raw.timestamp,
    event_type: 'service_metrics_snapshot',
    severity,
    message: flags.length
      ? `Service metrics — attention: ${flags.join(', ')}`
      : 'Service metrics snapshot (all within thresholds)',
    raw,
  };
}

module.exports = {
  collectServiceMetricsAsEvent,
  // exported for tests / selective use
  loadAverage,
  apiMetrics,
  postgres,
  redisMemory,
  bullmq,
  dockerRestarts,
  sslExpiry,
  failedSsh,
  orderSuccess,
  evaluate,
  defaultThresholds,
};
