'use strict';
// PHP-FPM monitoring: per-pool saturation + the single worker burning the most
// CPU / memory, AND the exact request it was running at that moment.
//
// PHP-FPM exposes a status page (pm.status_path in the pool conf). With ?full&json
// it returns every active worker including its last request's URI, method, CPU%,
// memory and duration — which is exactly "highest cpu/mem + that time's request".
//
// Enable on the server (in /etc/php/*/fpm/pool.d/www.conf):
//     pm.status_path = /fpm-status
// Expose it locally via nginx (restrict to 127.0.0.1):
//     location ~ ^/fpm-status$ { allow 127.0.0.1; deny all;
//       include fastcgi_params; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }
// Then reload php-fpm + nginx.
//
// Usage:
//   const { collectFpm } = require('./collectors/fpm');
//   const { metric, events } = await collectFpm(cfg);
//   if (metric) sender.enqueueMetric(metric);
//   events.forEach(e => sender.enqueueEvent(e));
//
// cfg.fpm: {
//   enabled: true,
//   pools: [
//     { name: 'www', status_url: 'http://127.0.0.1/fpm-status' },
//     // or via the fastcgi socket directly (needs cgi-fcgi: apt install libfcgi-bin):
//     { name: 'api', socket: '/run/php/php8.3-fpm.sock', status_path: '/fpm-status' },
//   ],
// }

const http = require('http');
const { execSync } = require('child_process');

// ── Fetch the FPM status JSON for one pool ──────────────────────────────────
function fetchViaHttp(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    u.searchParams.set('json', '');
    u.searchParams.set('full', '');
    const req = http.get(u, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('bad FPM JSON: ' + e.message)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('FPM status timeout')); });
    req.on('error', reject);
  });
}

// Fallback: query the FPM unix socket directly with cgi-fcgi (no web server needed).
function fetchViaSocket(socket, statusPath) {
  const env = [
    'SCRIPT_NAME=' + statusPath,
    'SCRIPT_FILENAME=' + statusPath,
    'QUERY_STRING=json&full',
    'REQUEST_METHOD=GET',
  ].map((e) => e.replace(/'/g, "")).join(' ');
  const out = execSync(
    `${env} REQUEST_URI='${statusPath}?json&full' cgi-fcgi -bind -connect ${socket}`,
    { encoding: 'utf8', timeout: 5000 },
  );
  const json = out.slice(out.indexOf('{')); // strip FastCGI headers
  return JSON.parse(json);
}

// ── Turn one pool's status into a metric row + saturation events ────────────
function analysePool(poolName, status) {
  const procs = Array.isArray(status.processes) ? status.processes : [];

  // Top CPU + top memory worker, each with the request it was serving.
  let topCpu = null;
  let topMem = null;
  for (const p of procs) {
    const cpu = Number(p['last request cpu'] ?? 0);
    const mem = Number(p['last request memory'] ?? 0);
    if (!topCpu || cpu > topCpu.cpu) topCpu = pick(p, cpu, mem);
    if (!topMem || mem > topMem.memory) topMem = pick(p, cpu, mem);
  }

  const active = Number(status['active processes'] ?? 0);
  const total = Number(status['total processes'] ?? 0);
  const idle = Number(status['idle processes'] ?? 0);
  const listenQueue = Number(status['listen queue'] ?? 0);
  const maxListenQueue = Number(status['max listen queue'] ?? 0);
  const maxActive = Number(status['max active processes'] ?? 0);
  const maxChildrenReached = Number(status['max children reached'] ?? 0);
  const slowRequests = Number(status['slow requests'] ?? 0);
  const utilisation = total > 0 ? (active / total) * 100 : 0;

  const metric = {
    timestamp: new Date().toISOString(),
    fpm_pool: poolName,
    fpm_active: active,
    fpm_idle: idle,
    fpm_total: total,
    fpm_utilisation: round(utilisation),       // active/total % — pool pressure
    fpm_listen_queue: listenQueue,             // requests waiting for a free worker
    fpm_max_listen_queue: maxListenQueue,
    fpm_max_active: maxActive,
    fpm_max_children_reached: maxChildrenReached,
    fpm_slow_requests: slowRequests,
    // The headline answers to "highest cpu/mem + that time's request":
    fpm_top_cpu: topCpu,
    fpm_top_memory: topMem,
  };

  const events = [];
  const ev = (type, severity, message, raw) => events.push({
    timestamp: new Date().toISOString(), event_type: type, severity, message,
    raw: { pool: poolName, ...raw },
  });

  // pm.max_children was hit → requests are being queued/dropped. Most important FPM alert.
  if (maxChildrenReached > 0) {
    ev('fpm_max_children_reached', 'high',
      `PHP-FPM pool "${poolName}" hit pm.max_children ${maxChildrenReached}x — raise max_children or workers are stuck`,
      { max_children_reached: maxChildrenReached });
  }
  // All workers busy → next request waits.
  if (utilisation >= 90 && total > 0) {
    ev('fpm_pool_saturated', utilisation >= 100 ? 'high' : 'medium',
      `PHP-FPM pool "${poolName}" ${round(utilisation)}% busy (${active}/${total} workers)`,
      { active, total, utilisation: round(utilisation) });
  }
  // Backlog of queued requests = users seeing latency.
  if (listenQueue > 0) {
    ev('fpm_listen_queue_backlog', listenQueue > 50 ? 'high' : 'medium',
      `PHP-FPM pool "${poolName}" has ${listenQueue} request(s) queued for a worker`,
      { listen_queue: listenQueue, max_listen_queue: maxListenQueue });
  }
  // Slow requests indicate code/DB problems (needs request_slowlog_timeout set).
  if (slowRequests > 0) {
    ev('fpm_slow_requests', 'medium',
      `PHP-FPM pool "${poolName}" recorded ${slowRequests} slow request(s)`,
      { slow_requests: slowRequests, slowest: topCpu });
  }
  // A single worker is very hot — surface the offending request.
  if (topCpu && topCpu.cpu >= 80) {
    ev('fpm_hot_worker', 'medium',
      `PHP-FPM worker (pool "${poolName}") at ${topCpu.cpu}% CPU on ${topCpu.method} ${topCpu.request_uri}`,
      { worker: topCpu });
  }

  return { metric, events };
}

function pick(p, cpu, mem) {
  return {
    pid: p.pid,
    state: p.state,
    cpu: round(cpu),                                   // % CPU of its LAST request
    memory: mem,                                        // bytes used by last request
    memory_mb: round(mem / 1048576),
    request_uri: p['request uri'] || p.script || '',    // ← the request at that time
    method: p['request method'] || '',
    duration_ms: round(Number(p['request duration'] ?? 0) / 1000), // µs → ms
    content_length: Number(p['content length'] ?? 0),
    user: p.user || '-',
    script: p.script || '',
    requests_served: Number(p.requests ?? 0),
  };
}

function round(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

// ── Public: collect every configured pool ───────────────────────────────────
async function collectFpm(cfg) {
  const fpm = cfg && cfg.fpm;
  if (!fpm || !fpm.enabled || !Array.isArray(fpm.pools)) {
    return { metrics: [], events: [] };
  }
  const metrics = [];
  const events = [];
  for (const pool of fpm.pools) {
    try {
      let status;
      if (pool.status_url) status = await fetchViaHttp(pool.status_url);
      else if (pool.socket) status = fetchViaSocket(pool.socket, pool.status_path || '/fpm-status');
      else continue;
      const res = analysePool(pool.name || status.pool || 'www', status);
      metrics.push(res.metric);
      events.push(...res.events);
    } catch (e) {
      events.push({
        timestamp: new Date().toISOString(),
        event_type: 'fpm_unreachable',
        severity: 'high',
        message: `PHP-FPM pool "${pool.name || '?'}" status unreachable: ${String(e.message).slice(0, 80)}`,
        raw: { pool: pool.name },
      });
    }
  }
  return { metrics, events };
}

// Convenience: return everything as security-events so the data is visible in
// the dashboard with NO schema change. Each pool yields one `fpm_pool_snapshot`
// (full metric in `raw`) plus its saturation/hot-worker alerts.
async function collectFpmAsEvents(cfg) {
  const { metrics, events } = await collectFpm(cfg);
  const snapshots = metrics.map((m) => ({
    timestamp: m.timestamp,
    event_type: 'fpm_pool_snapshot',
    severity: 'info',
    message: `FPM "${m.fpm_pool}" ${m.fpm_utilisation}% busy (${m.fpm_active}/${m.fpm_total}); ` +
      (m.fpm_top_cpu ? `top CPU ${m.fpm_top_cpu.cpu}% on ${m.fpm_top_cpu.method} ${m.fpm_top_cpu.request_uri}` : 'no active workers'),
    raw: m,
  }));
  return [...snapshots, ...events];
}

module.exports = { collectFpm, collectFpmAsEvents, analysePool };
