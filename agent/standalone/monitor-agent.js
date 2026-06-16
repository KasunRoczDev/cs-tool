#!/usr/bin/env node
'use strict';
/*
 * Self-contained Ubuntu monitoring agent (single file, zero npm dependencies).
 * Config comes from environment variables (set in the systemd unit):
 *   MONITOR_SERVER_URL   (required)  e.g. https://monitor.example.com:4000
 *   MONITOR_API_KEY      (required)  per-server key from the dashboard
 *   MONITOR_METRICS_INTERVAL  seconds between metric samples   (default 15)
 *   MONITOR_SEND_INTERVAL     seconds between flushes          (default 30)
 *   MONITOR_METRICS           "false" to disable metrics       (default true)
 *   MONITOR_SECURITY          "false" to disable security logs (default true)
 *   MONITOR_TLS_VERIFY        "false" only for self-signed lab (default true)
 *   MONITOR_BUFFER_FILE       offline buffer path (default /var/lib/monitor-agent/buffer.ndjson)
 *   MONITOR_AUTH_LOG          fallback log (default /var/log/auth.log)
 *   MONITOR_USE_JOURNALD      "false" to force auth.log        (default true)
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
  metrics: process.env.MONITOR_METRICS !== 'false',
  security_logs: process.env.MONITOR_SECURITY !== 'false',
  tls_verify: process.env.MONITOR_TLS_VERIFY !== 'false',
  buffer_file: process.env.MONITOR_BUFFER_FILE || '/var/lib/monitor-agent/buffer.ndjson',
  buffer_max_items: 50000,
  auth_log: process.env.MONITOR_AUTH_LOG || '/var/log/auth.log',
  use_journald: process.env.MONITOR_USE_JOURNALD !== 'false',
};
if (!CFG.server_url || !CFG.api_key) {
  console.error('[agent] MONITOR_SERVER_URL and MONITOR_API_KEY are required');
  process.exit(1);
}

/* ---------------- metrics ---------------- */
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
const rnd = (v) => (v == null ? null : Math.round(v * 100) / 100);
function collectMetric() {
  const n = net();
  return { timestamp: new Date().toISOString(), cpu: rnd(cpuPct()), memory: rnd(memPct()),
    disk: rnd(diskPct('/')), net_in: rnd(n.net_in), net_out: rnd(n.net_out), load_avg: rnd(os.loadavg()[0]) };
}

/* ---------------- security ---------------- */
const PATTERNS = [
  { re: /Failed password for(?: invalid user)? (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_failed_login', severity: 'medium', username: m[1], source_ip: m[2], message: `Failed SSH login for ${m[1]} from ${m[2]}` }) },
  { re: /Accepted password for (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_login', severity: 'low', username: m[1], source_ip: m[2], message: `Accepted SSH login for ${m[1]} from ${m[2]}` }) },
  { re: /Accepted publickey for (\S+) from (\S+)/, b: (m) => ({ event_type: 'ssh_login', severity: 'low', username: m[1], source_ip: m[2], message: `Accepted SSH publickey for ${m[1]} from ${m[2]}` }) },
  { re: /sudo:\s+(\S+)\s+:.*COMMAND=(.+)$/, b: (m) => ({ event_type: 'sudo', severity: 'low', username: m[1], message: `sudo by ${m[1]}: ${m[2]}` }) },
  { re: /\[UFW BLOCK\].*SRC=(\S+).*DST=(\S+).*(?:DPT=(\d+))?/, b: (m) => ({ event_type: 'firewall_block', severity: 'medium', source_ip: m[1], message: `UFW blocked ${m[1]} -> ${m[2]}${m[3] ? ':' + m[3] : ''}` }) },
];
function parseLine(line, onEvent) {
  for (const p of PATTERNS) { const m = line.match(p.re); if (m) { onEvent({ timestamp: new Date().toISOString(), ...p.b(m) }); return; } }
}
function cmdExists(c) { try { execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch { return false; } }
function spawnTail(cmd, args, onEvent, label) {
  let child; try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { console.warn(`[security] cannot start ${label}: ${e.message}`); return null; }
  let buf = '';
  child.stdout.on('data', (ch) => { buf += ch.toString(); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) parseLine(l, onEvent); });
  child.on('error', (e) => console.warn(`[security] ${label}: ${e.message}`));
  child.on('exit', (c) => console.warn(`[security] ${label} exited (${c})`));
  return child;
}
function startSecurity(onEvent) {
  const kids = [];
  if (CFG.use_journald && cmdExists('journalctl')) {
    kids.push(spawnTail('journalctl', ['-f', '-n', '0', '-o', 'cat', '_COMM=sshd', '+', '_COMM=sudo', '+', '_TRANSPORT=kernel'], onEvent, 'journalctl'));
  } else if (fs.existsSync(CFG.auth_log)) {
    kids.push(spawnTail('tail', ['-F', '-n', '0', CFG.auth_log], onEvent, 'auth.log'));
  } else { console.warn('[security] no journald and auth_log missing; disabled'); }
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
let mt, st, stopSec = () => {};
if (CFG.metrics) { collectMetric(); mt = setInterval(() => { try { mq.push(collectMetric()); } catch (e) { console.warn(e.message); } }, CFG.metrics_interval * 1000); }
if (CFG.security_logs) stopSec = startSecurity((ev) => eq.push(ev));
st = setInterval(() => flush().catch((e) => console.warn(e.message)), CFG.send_interval * 1000);
const shutdown = async (s) => { console.log(`[agent] ${s}, flushing`); clearInterval(mt); clearInterval(st); stopSec(); await flush().catch(() => {}); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
