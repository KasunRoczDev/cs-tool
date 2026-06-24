#!/usr/bin/env node
'use strict';
/*
 * Self-contained Ubuntu monitoring agent (single file, zero npm dependencies).
 * Config comes from environment variables (set in the systemd unit):
 *   MONITOR_SERVER_URL   (required)  e.g. https://monitor.example.com:4000
 *   MONITOR_API_KEY      (required)  per-server key from the dashboard
 *   MONITOR_METRICS_INTERVAL  seconds between metric samples   (default 15)
 *   MONITOR_SEND_INTERVAL     seconds between flushes          (default 30)
 *   MONITOR_SNAPSHOT_INTERVAL seconds between FPM/extended snapshots (default 60)
 *   MONITOR_METRICS           "false" to disable metrics       (default true)
 *   MONITOR_SECURITY          "false" to disable security logs (default true)
 *   MONITOR_TLS_VERIFY        "false" only for self-signed lab (default true)
 *   MONITOR_BUFFER_FILE       offline buffer path (default /var/lib/monitor-agent/buffer.ndjson)
 *   MONITOR_AUTH_LOG          fallback log (default /var/log/auth.log)
 *   MONITOR_USE_JOURNALD      "false" to force auth.log        (default true)
 *   MONITOR_NGINX_ACCESS_LOG  nginx access log (default /var/log/nginx/access.log)
 *   MONITOR_FPM_STATUS_URL    enable PHP-FPM monitoring, e.g. http://127.0.0.1/fpm-status
 *   MONITOR_FPM_POOL          pool label for the above         (default www)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');

const CFG = {
  server_url: process.env.MONITOR_SERVER_URL || '',
  api_key: process.env.MONITOR_API_KEY || '',
  metrics_interval: Number(process.env.MONITOR_METRICS_INTERVAL || 15),
  send_interval: Number(process.env.MONITOR_SEND_INTERVAL || 30),
  snapshot_interval: Number(process.env.MONITOR_SNAPSHOT_INTERVAL || 60),
  metrics: process.env.MONITOR_METRICS !== 'false',
  security_logs: process.env.MONITOR_SECURITY !== 'false',
  tls_verify: process.env.MONITOR_TLS_VERIFY !== 'false',
  buffer_file: process.env.MONITOR_BUFFER_FILE || '/var/lib/monitor-agent/buffer.ndjson',
  buffer_max_items: 50000,
  auth_log: process.env.MONITOR_AUTH_LOG || '/var/log/auth.log',
  use_journald: process.env.MONITOR_USE_JOURNALD !== 'false',
  nginx_access_log: process.env.MONITOR_NGINX_ACCESS_LOG || '/var/log/nginx/access.log',
  fpm_status_url: process.env.MONITOR_FPM_STATUS_URL || '',
  fpm_pool: process.env.MONITOR_FPM_POOL || 'www',
};
if (!CFG.server_url || !CFG.api_key) {
  console.error('[agent] MONITOR_SERVER_URL and MONITOR_API_KEY are required');
  process.exit(1);
}
const rnd = (v) => (v == null ? null : Math.round(v * 100) / 100);

/* ---------------- base metrics ---------------- */
let prevCpu = null, prevNet = null, prevNetTime = null;
function readCpu() {
  const p = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0]
    .trim().split(/\s+/).slice(1).map(Number);
  return { idle: p[3] + (p[4] || 0), total: p.reduce((a, b) => a + b, 0) };
}
function cpuPct() {
  try {
    const c = readCpu();
    if (!prevCpu) { prevCpu = c; return null; }
    const di = c.idle - prevCpu.idle, dt = c.total - prevCpu.total;
    prevCpu = c;
    return dt <= 0 ? null : Math.max(0, Math.min(100, (1 - di / dt) * 100));
  } catch { return null; }
}
function memPct() {
  try {
    const i = fs.readFileSync('/proc/meminfo', 'utf8');
    const g = (k) => Number(i.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
    const t = g('MemTotal'); return t ? ((t - g('MemAvailable')) / t) * 100 : null;
  } catch { const t = os.totalmem(); return ((t - os.freemem()) / t) * 100; }
}
function diskPct(m = '/') {
  try { return Number(execSync(`df -P ${m} | tail -1`, { encoding: 'utf8' }).trim().split(/\s+/)[4].replace('%', '')); }
  catch { return null; }
}
function net() {
  try {
    const ls = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0, tx = 0;
    for (const l of ls) {
      const [ifc, rest] = l.split(':');
      if (!rest || ifc.trim() === 'lo') continue;
      const c = rest.trim().split(/\s+/).map(Number); rx += c[0]; tx += c[8];
    }
    const now = Date.now();
    if (!prevNet) { prevNet = { rx, tx }; prevNetTime = now; return { net_in: null, net_out: null }; }
    const dt = (now - prevNetTime) / 1000 || 1;
    const r = { net_in: Math.max(0, (rx - prevNet.rx) / dt), net_out: Math.max(0, (tx - prevNet.tx) / dt) };
    prevNet = { rx, tx }; prevNetTime = now; return r;
  } catch { return { net_in: null, net_out: null }; }
}
function collectMetric() {
  const n = net();
  return { timestamp: new Date().toISOString(), cpu: rnd(cpuPct()), memory: rnd(memPct()),
    disk: rnd(diskPct('/')), net_in: rnd(n.net_in), net_out: rnd(n.net_out), load_avg: rnd(os.loadavg()[0]) };
}

/* ---------------- extended metrics (snapshot event) ---------------- */
let prevIo = null, prevIoTime = null;
function swapPct() {
  try { const i = fs.readFileSync('/proc/meminfo', 'utf8');
    const g = (k) => Number(i.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
    const t = g('SwapTotal'); return t ? ((t - g('SwapFree')) / t) * 100 : 0; } catch { return null; }
}
function inodePct(m = '/') {
  try { return Number(execSync(`df -iP ${m} | tail -1`, { encoding: 'utf8', timeout: 4000 }).trim().split(/\s+/)[4].replace('%', '')); }
  catch { return null; }
}
function diskIo() {
  try {
    let rs = 0, ws = 0, q = 0;
    for (const l of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
      const c = l.trim().split(/\s+/); if (c.length < 14) continue;
      const d = c[2]; if (/\d$/.test(d) || /^(loop|ram|fd)/.test(d)) continue;
      rs += Number(c[5]); ws += Number(c[9]); q += Number(c[11]);
    }
    const now = Date.now();
    if (!prevIo) { prevIo = { rs, ws }; prevIoTime = now; return { disk_read_bps: null, disk_write_bps: null, disk_io_queue: q }; }
    const dt = (now - prevIoTime) / 1000 || 1;
    const r = { disk_read_bps: Math.max(0, ((rs - prevIo.rs) * 512) / dt), disk_write_bps: Math.max(0, ((ws - prevIo.ws) * 512) / dt), disk_io_queue: q };
    prevIo = { rs, ws }; prevIoTime = now; return r;
  } catch { return { disk_read_bps: null, disk_write_bps: null, disk_io_queue: null }; }
}
function conntrackPct() {
  try { const c = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_count', 'utf8').trim());
    const m = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_max', 'utf8').trim());
    return m ? (c / m) * 100 : null; } catch { return null; }
}
function fdPct() {
  try { const [a, , m] = fs.readFileSync('/proc/sys/fs/file-nr', 'utf8').trim().split(/\s+/).map(Number);
    return m ? (a / m) * 100 : null; } catch { return null; }
}
function tcpStates() {
  try {
    const o = execSync('ss -tan 2>/dev/null', { encoding: 'utf8', timeout: 4000 });
    const s = { ESTAB: 0, 'TIME-WAIT': 0, 'CLOSE-WAIT': 0, 'SYN-RECV': 0 };
    for (const line of o.split('\n').slice(1)) { const st = line.trim().split(/\s+/)[0]; if (st in s) s[st]++; }
    return { tcp_established: s.ESTAB, tcp_time_wait: s['TIME-WAIT'], tcp_close_wait: s['CLOSE-WAIT'], tcp_syn_recv: s['SYN-RECV'] };
  } catch { return { tcp_established: null, tcp_time_wait: null, tcp_close_wait: null, tcp_syn_recv: null }; }
}
function procStats() {
  try {
    const pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
    let z = 0;
    for (const pid of pids) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); if (s.slice(s.lastIndexOf(')') + 2)[0] === 'Z') z++; } catch {} }
    const running = Number(fs.readFileSync('/proc/stat', 'utf8').match(/procs_running\s+(\d+)/)?.[1] ?? 0);
    return { proc_total: pids.length, proc_running: running, proc_zombie: z };
  } catch { return { proc_total: null, proc_running: null, proc_zombie: null }; }
}
function loadAvgs() {
  try { const [l1, l5, l15] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number);
    const cores = os.cpus().length || 1;
    return { load_avg_5: l5, load_avg_15: l15, load_per_core: rnd(l1 / cores) }; }
  catch { return { load_avg_5: null, load_avg_15: null, load_per_core: null }; }
}
function uptimeS() { try { return Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0])); } catch { return null; } }
function timeDriftMs() {
  try { const o = execSync('chronyc tracking 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const m = o.match(/System time\s+:\s+([\d.]+)\s+seconds/); return m ? rnd(Number(m[1]) * 1000) : null; }
  catch { return null; }
}
function collectExtended() {
  const io = diskIo();
  return { timestamp: new Date().toISOString(), swap: rnd(swapPct()), inode: rnd(inodePct('/')),
    disk_read_bps: rnd(io.disk_read_bps), disk_write_bps: rnd(io.disk_write_bps), disk_io_queue: io.disk_io_queue,
    conntrack: rnd(conntrackPct()), fd_usage: rnd(fdPct()), ...tcpStates(), ...procStats(), ...loadAvgs(),
    uptime: uptimeS(), time_drift_ms: timeDriftMs() };
}
function extendedEvent() {
  const m = collectExtended();
  const flags = [];
  if (m.swap != null && m.swap >= 25) flags.push(`swap ${m.swap}%`);
  if (m.conntrack != null && m.conntrack >= 70) flags.push(`conntrack ${m.conntrack}%`);
  if (m.fd_usage != null && m.fd_usage >= 70) flags.push(`fd ${m.fd_usage}%`);
  if (m.tcp_syn_recv != null && m.tcp_syn_recv >= 256) flags.push(`SYN_RECV ${m.tcp_syn_recv}`);
  if (m.proc_zombie != null && m.proc_zombie >= 20) flags.push(`${m.proc_zombie} zombies`);
  return { timestamp: m.timestamp, event_type: 'system_extended_snapshot', severity: flags.length ? 'medium' : 'info',
    message: flags.length ? `Extended host metrics - attention: ${flags.join(', ')}`
      : `Extended host metrics snapshot (swap ${m.swap}%, conntrack ${m.conntrack ?? 'n/a'}%, fd ${m.fd_usage}%)`, raw: m };
}

/* ---------------- PHP-FPM (snapshot event) ---------------- */
async function fetchFpm(url) {
  const u = new URL(url); u.searchParams.set('json', ''); u.searchParams.set('full', '');
  const opts = u.protocol === 'https:' ? { agent } : {};
  const res = await fetch(u, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function fpmPick(p) {
  const mem = Number(p['last request memory'] ?? 0);
  const wait = p['request wait'] != null ? rnd(Number(p['request wait']) / 1000)
    : (p.wait_ms != null ? rnd(Number(p.wait_ms)) : null);
  return { pid: p.pid, state: p.state, cpu: rnd(Number(p['last request cpu'] ?? 0)), memory: mem,
    memory_mb: rnd(mem / 1048576), request_uri: p['request uri'] || p.script || '', method: p['request method'] || '',
    duration_ms: rnd(Number(p['request duration'] ?? 0) / 1000), wait_ms: wait, user: p.user || '-', requests_served: Number(p.requests ?? 0) };
}
function analyseFpm(pool, status) {
  const procs = Array.isArray(status.processes) ? status.processes : [];
  let topCpu = null, topMem = null;
  // Idle workers only: their uri + cpu + duration describe the same completed
  // request. Running workers report cpu/mem from the PREVIOUS request, so pairing
  // them with the in-progress uri/duration is wrong.
  for (const p of procs) {
    if (String(p.state).toLowerCase() !== 'idle') continue;
    const c = Number(p['last request cpu'] ?? 0), m = Number(p['last request memory'] ?? 0);
    if (!topCpu || c > topCpu.cpu) topCpu = fpmPick(p);
    if (!topMem || m > topMem.memory) topMem = fpmPick(p);
  }
  const active = Number(status['active processes'] ?? 0), total = Number(status['total processes'] ?? 0);
  const idle = Number(status['idle processes'] ?? 0), lq = Number(status['listen queue'] ?? 0);
  const mlq = Number(status['max listen queue'] ?? 0), ma = Number(status['max active processes'] ?? 0);
  const mcr = Number(status['max children reached'] ?? 0), slow = Number(status['slow requests'] ?? 0);
  const util = total > 0 ? (active / total) * 100 : 0;
  const metric = { timestamp: new Date().toISOString(), fpm_pool: pool, fpm_active: active, fpm_idle: idle,
    fpm_total: total, fpm_utilisation: rnd(util), fpm_listen_queue: lq, fpm_max_listen_queue: mlq,
    fpm_max_active: ma, fpm_max_children_reached: mcr, fpm_slow_requests: slow, fpm_top_cpu: topCpu, fpm_top_memory: topMem };
  const events = [];
  const ev = (t, s, msg, raw) => events.push({ timestamp: new Date().toISOString(), event_type: t, severity: s, message: msg, raw: { pool, ...raw } });
  if (mcr > 0) ev('fpm_max_children_reached', 'high', `PHP-FPM pool "${pool}" hit pm.max_children ${mcr}x`, { max_children_reached: mcr });
  if (util >= 90 && total > 0) ev('fpm_pool_saturated', util >= 100 ? 'high' : 'medium', `PHP-FPM pool "${pool}" ${rnd(util)}% busy (${active}/${total})`, { utilisation: rnd(util) });
  if (lq > 0) ev('fpm_listen_queue_backlog', lq > 50 ? 'high' : 'medium', `PHP-FPM pool "${pool}" has ${lq} request(s) queued`, { listen_queue: lq });
  if (slow > 0) ev('fpm_slow_requests', 'medium', `PHP-FPM pool "${pool}" recorded ${slow} slow request(s)`, { slow_requests: slow });
  if (topCpu && topCpu.cpu >= 80) ev('fpm_hot_worker', 'medium', `PHP-FPM worker (pool "${pool}") at ${topCpu.cpu}% CPU on ${topCpu.method} ${topCpu.request_uri}`, { worker: topCpu });
  return { metric, events };
}
async function fpmEvents() {
  if (!CFG.fpm_status_url) return [];
  try {
    const status = await fetchFpm(CFG.fpm_status_url);
    const { metric, events } = analyseFpm(CFG.fpm_pool || status.pool || 'www', status);
    const snap = { timestamp: metric.timestamp, event_type: 'fpm_pool_snapshot', severity: 'info',
      message: `FPM "${metric.fpm_pool}" ${metric.fpm_utilisation}% busy (${metric.fpm_active}/${metric.fpm_total}); ` +
        (metric.fpm_top_cpu ? `top CPU ${metric.fpm_top_cpu.cpu}% on ${metric.fpm_top_cpu.method} ${metric.fpm_top_cpu.request_uri}` : 'no active workers'), raw: metric };
    return [snap, ...events];
  } catch (e) {
    return [{ timestamp: new Date().toISOString(), event_type: 'fpm_unreachable', severity: 'high',
      message: `PHP-FPM status unreachable: ${String(e.message).slice(0, 80)}`, raw: { pool: CFG.fpm_pool } }];
  }
}

/* ---------------- security: syslog/auth patterns ---------------- */
const PATTERNS = [
  { re: /Failed password for(?: invalid user)? (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_failed_login', severity: 'medium', username: m[1], source_ip: m[2], message: `Failed SSH login for ${m[1]} from ${m[2]}` }) },
  { re: /Accepted (?:password|publickey) for (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_login', severity: 'low', username: m[1], source_ip: m[2], message: `SSH login accepted for ${m[1]} from ${m[2]}` }) },
  { re: /Invalid user (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_failed_login', severity: 'medium', username: m[1], source_ip: m[2], message: `SSH invalid user ${m[1]} from ${m[2]}` }) },
  { re: /error: maximum authentication attempts exceeded for(?: invalid user)? (\S+) from (\S+)/, b: (m) => ({ event_type: 'brute_force', severity: 'high', username: m[1], source_ip: m[2], message: `SSH brute force for ${m[1]} from ${m[2]}` }) },
  { re: /sudo:\s+(\S+)\s+:.*COMMAND=(.+)$/, b: (m) => ({ event_type: 'sudo', severity: 'low', username: m[1], message: `sudo by ${m[1]}: ${m[2].trim()}` }) },
  { re: /sudo:\s+(\S+)\s+:.*authentication failure/, b: (m) => ({ event_type: 'privilege_escalation', severity: 'high', username: m[1], message: `sudo auth failure for ${m[1]}` }) },
  { re: /su:\s+(?:FAILED SU|pam_unix.*authentication failure).*user=(\S+)/, b: (m) => ({ event_type: 'privilege_escalation', severity: 'high', username: m[1], message: `su auth failure for ${m[1]}` }) },
  { re: /\[UFW BLOCK\].*SRC=(\S+).*DST=(\S+).*(?:DPT=(\d+))?/, b: (m) => ({ event_type: 'firewall_block', severity: 'medium', source_ip: m[1], message: `UFW blocked ${m[1]} -> ${m[2]}${m[3] ? ':' + m[3] : ''}` }) },
  { re: /iptables.*BLOCK.*SRC=(\S+)/, b: (m) => ({ event_type: 'firewall_block', severity: 'medium', source_ip: m[1], message: `iptables blocked ${m[1]}` }) },
];
function parseLine(line, onEvent) {
  for (const p of PATTERNS) { const m = line.match(p.re); if (m) { onEvent({ timestamp: new Date().toISOString(), ...p.b(m) }); return; } }
}

/* ---------------- security: nginx access-log attack detection ---------------- */
const NGINX_RE = /^(\S+) - \S+ \[[^\]]+\] "([A-Z]+) ([^\s"]*) HTTP\/[\d.]+"\s+(\d{3})\s+\d+\s+"[^"]*"\s+"([^"]*)"/;
const DANGEROUS_PATHS = [
  { re: /(?:\.\.\/|\.\.\\|%2e%2e|%252e)/i,               type: 'nginx_path_traversal', severity: 'high',     label: 'Path traversal' },
  { re: /\/\.env(?:\b|$)/,                                type: 'nginx_exploit_probe', severity: 'critical', label: '.env file probe' },
  { re: /\/\.git\//,                                      type: 'nginx_exploit_probe', severity: 'critical', label: '.git directory probe' },
  { re: /\/(?:wp-login|wp-admin|xmlrpc)\.php/i,           type: 'nginx_exploit_probe', severity: 'high',     label: 'WordPress attack probe' },
  { re: /\/(?:phpMyAdmin|phpmyadmin|pma)\//i,             type: 'nginx_exploit_probe', severity: 'high',     label: 'phpMyAdmin probe' },
  { re: /\/(?:shell|cmd|exec|eval)(?:\.php|\.asp|\?)/i,   type: 'nginx_exploit_probe', severity: 'critical', label: 'Shell/RCE probe' },
  { re: /(?:etc\/passwd|etc\/shadow|proc\/self)/i,        type: 'nginx_exploit_probe', severity: 'critical', label: 'System file probe' },
  { re: /wp-config\.php/i,                                type: 'nginx_exploit_probe', severity: 'critical', label: 'WordPress config probe' },
  { re: /(?:union[\s+%20]+select|drop[\s+%20]+table)/i,   type: 'sql_injection',       severity: 'critical', label: 'SQL injection in URL' },
  { re: /(?:<script|javascript:|onerror\s*=|onload\s*=)/i, type: 'xss',               severity: 'high',     label: 'XSS attempt in URL' },
  { re: /\/(?:cgi-bin|cgi)\/\S+\.(?:pl|sh|cgi)/i,         type: 'nginx_exploit_probe', severity: 'medium',  label: 'CGI script probe' },
  { re: /\.(bak|backup|old|sql|dump|tar\.gz)(\?|$)/i,     type: 'nginx_exploit_probe', severity: 'medium',  label: 'Backup file probe' },
  { re: /\/(?:actuator|metrics|health|env|info|mappings)\b/, type: 'nginx_exploit_probe', severity: 'high', label: 'Spring Actuator probe' },
];
const SCANNER_UA_RE = /(?:zgrab|masscan|sqlmap|nikto|nessus|openvas|dirbuster|gobuster|wfuzz|nuclei|acunetix|nmap|python-requests\/[0-2]\.|libwww-perl|curl\/[0-7]\.|scrapy|harvester)/i;
function parseNginxLine(line, onEvent) {
  const m = line.match(NGINX_RE);
  if (!m) return;
  const [, ip, method, rawPath, statusStr, ua] = m;
  const status = parseInt(statusStr, 10);
  const p = rawPath.substring(0, 300);
  // Slow-request bottleneck (needs nginx log_format to append rt=$request_time
  // [urt=$upstream_response_time]). MONITOR_NGINX_SLOW_SECONDS overrides default 1s.
  const rtm = line.match(/\brt=(\d+(?:\.\d+)?)/);
  if (rtm) {
    const rt = parseFloat(rtm[1]);
    if (rt >= (Number(process.env.MONITOR_NGINX_SLOW_SECONDS) || 1.0)) {
      const urtm = line.match(/\burt=(\d+(?:\.\d+)?)/);
      onEvent({ timestamp: new Date().toISOString(), event_type: 'nginx_slow_request',
        severity: rt >= 5 ? 'high' : rt >= 2 ? 'medium' : 'low', source_ip: ip,
        message: 'Slow request ' + rt + 's: ' + method + ' ' + p.substring(0, 140) + ' (HTTP ' + status + ')',
        raw: { method, path: p, status, request_time: rt, upstream_time: urtm ? parseFloat(urtm[1]) : null } });
    }
  }
  for (const dp of DANGEROUS_PATHS) {
    if (dp.re.test(p)) {
      onEvent({ timestamp: new Date().toISOString(), event_type: dp.type, severity: dp.severity, source_ip: ip,
        message: dp.label + ': ' + method + ' ' + p.substring(0, 120) + ' (HTTP ' + status + ')',
        raw: { method, path: p, status, user_agent: ua.substring(0, 250) } });
      return;
    }
  }
  if (SCANNER_UA_RE.test(ua)) {
    onEvent({ timestamp: new Date().toISOString(), event_type: 'nginx_scan', severity: 'medium', source_ip: ip,
      message: 'Scanner/bot UA: ' + ua.substring(0, 100) + ' -> ' + method + ' ' + p.substring(0, 80),
      raw: { method, path: p, status, user_agent: ua.substring(0, 250) } });
    return;
  }
  if (status >= 500 && ip !== '127.0.0.1' && ip !== '::1') {
    onEvent({ timestamp: new Date().toISOString(), event_type: 'nginx_server_error', severity: 'medium', source_ip: ip,
      message: 'HTTP ' + status + ': ' + method + ' ' + p.substring(0, 100), raw: { method, path: p, status } });
  }
}

function cmdExists(c) { try { execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch { return false; } }
function spawnTail(cmd, args, onEvent, label, parser) {
  const fn = parser || parseLine;
  let child; try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { console.warn(`[security] cannot start ${label}: ${e.message}`); return null; }
  let buf = '';
  child.stdout.on('data', (ch) => { buf += ch.toString(); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) fn(l, onEvent); });
  child.on('error', (e) => console.warn(`[security] ${label}: ${e.message}`));
  child.on('exit', (c) => console.warn(`[security] ${label} exited (${c})`));
  return child;
}
function startSecurity(onEvent) {
  const kids = [];
  if (CFG.use_journald && cmdExists('journalctl')) {
    kids.push(spawnTail('journalctl', ['-f', '-n', '0', '-o', 'cat', '_COMM=sshd', '+', '_COMM=sudo', '+', '_COMM=su', '+', '_TRANSPORT=kernel'], onEvent, 'journalctl'));
  } else if (fs.existsSync(CFG.auth_log)) {
    kids.push(spawnTail('tail', ['-F', '-n', '0', CFG.auth_log], onEvent, 'auth.log'));
  } else { console.warn('[security] no journald and auth_log missing; auth detection disabled'); }
  // nginx access log -> dangerous-path / scanner / 5xx detection (previously missing).
  if (CFG.nginx_access_log && fs.existsSync(CFG.nginx_access_log)) {
    kids.push(spawnTail('tail', ['-F', '-n', '0', CFG.nginx_access_log], onEvent, 'nginx:' + CFG.nginx_access_log, parseNginxLine));
    console.log('[security] tailing nginx access log: ' + CFG.nginx_access_log);
  } else {
    console.warn('[security] nginx access log not found (' + CFG.nginx_access_log + '); web-attack detection disabled');
  }
  return () => kids.forEach((k) => k && k.kill());
}

/* ---------------- sender ---------------- */
const mq = [], eq = [];
const agent = new https.Agent({ rejectUnauthorized: CFG.tls_verify });
function loadBuffer() {
  try {
    if (!fs.existsSync(CFG.buffer_file)) return;
    for (const l of fs.readFileSync(CFG.buffer_file, 'utf8').split('\n').filter(Boolean)) {
      const { t, d } = JSON.parse(l); if (t === 'm') mq.push(d); else if (t === 'e') eq.push(d);
    }
    console.log(`[sender] restored buffered items`);
  } catch (e) { console.warn(`[sender] buffer load: ${e.message}`); }
}
function saveBuffer() {
  try {
    fs.mkdirSync(path.dirname(CFG.buffer_file), { recursive: true });
    fs.writeFileSync(CFG.buffer_file, [...mq.map((m) => JSON.stringify({ t: 'm', d: m })), ...eq.map((e) => JSON.stringify({ t: 'e', d: e }))].join('\n'));
  } catch (e) { console.warn(`[sender] buffer save: ${e.message}`); }
}
async function post(p, body) {
  const url = CFG.server_url.replace(/\/$/, '') + p;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': CFG.api_key }, body: JSON.stringify(body), ...(url.startsWith('https') ? { agent } : {}) });
    if (res.ok) return true; console.warn(`[sender] ${p} -> HTTP ${res.status}`); return false;
  } catch (e) { console.warn(`[sender] ${p} failed: ${e.message} (buffering)`); return false; }
}
async function flush() {
  if (mq.length) { const b = mq.splice(0, mq.length); if (!(await post('/api/v1/metrics', { metrics: b }))) mq.unshift(...b); }
  if (eq.length) { const b = eq.splice(0, eq.length); if (!(await post('/api/v1/security-events', { events: b }))) eq.unshift(...b); }
  if (mq.length > CFG.buffer_max_items) mq.splice(0, mq.length - CFG.buffer_max_items);
  if (eq.length > CFG.buffer_max_items) eq.splice(0, eq.length - CFG.buffer_max_items);
  saveBuffer();
}

/* ---------------- main ---------------- */
console.log(`[agent] starting -> ${CFG.server_url}`);
loadBuffer();
let mt, st, snap, stopSec = () => {};
if (CFG.metrics) { collectMetric(); mt = setInterval(() => { try { mq.push(collectMetric()); } catch (e) { console.warn(e.message); } }, CFG.metrics_interval * 1000); }
if (CFG.security_logs) stopSec = startSecurity((ev) => eq.push(ev));
async function emitSnapshots() {
  try { eq.push(extendedEvent()); } catch (e) { console.warn('[snapshot] extended: ' + e.message); }
  try { (await fpmEvents()).forEach((ev) => eq.push(ev)); } catch (e) { console.warn('[snapshot] fpm: ' + e.message); }
}
if (CFG.metrics) { emitSnapshots(); snap = setInterval(emitSnapshots, CFG.snapshot_interval * 1000); }
st = setInterval(() => flush().catch((e) => console.warn(e.message)), CFG.send_interval * 1000);
const shutdown = async (s) => { console.log(`[agent] ${s}, flushing`); clearInterval(mt); clearInterval(st); clearInterval(snap); stopSec(); await flush().catch(() => {}); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
