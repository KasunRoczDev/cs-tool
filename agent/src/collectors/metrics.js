'use strict';
// System metric collection using Linux /proc + os module.
// Keeps CPU usage stateful between samples.
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let prevCpu = null;
let prevNet = null;
let prevNetTime = null;

function readCpuTotals() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] || 0); // idle + iowait
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function cpuUsagePercent() {
  try {
    const cur = readCpuTotals();
    if (!prevCpu) {
      prevCpu = cur;
      return null; // need two samples
    }
    const dIdle = cur.idle - prevCpu.idle;
    const dTotal = cur.total - prevCpu.total;
    prevCpu = cur;
    if (dTotal <= 0) return null;
    return Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
  } catch {
    // Fallback to load-based estimate
    return null;
  }
}

function memoryUsagePercent() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number(info.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (!total) return null;
    return ((total - avail) / total) * 100;
  } catch {
    const total = os.totalmem();
    return ((total - os.freemem()) / total) * 100;
  }
}

function diskUsagePercent(mount = '/') {
  try {
    const out = execSync(`df -P ${mount} | tail -1`, { encoding: 'utf8' });
    const pct = out.trim().split(/\s+/)[4]; // e.g. "73%"
    return Number(pct.replace('%', ''));
  } catch {
    return null;
  }
}

function networkBytesPerSec() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0;
    let tx = 0;
    for (const l of lines) {
      const [iface, rest] = l.split(':');
      if (!rest) continue;
      if (iface.trim() === 'lo') continue;
      const cols = rest.trim().split(/\s+/).map(Number);
      rx += cols[0];
      tx += cols[8];
    }
    const now = Date.now();
    if (!prevNet) {
      prevNet = { rx, tx };
      prevNetTime = now;
      return { net_in: null, net_out: null };
    }
    const dt = (now - prevNetTime) / 1000 || 1;
    const result = {
      net_in: Math.max(0, (rx - prevNet.rx) / dt),
      net_out: Math.max(0, (tx - prevNet.tx) / dt),
    };
    prevNet = { rx, tx };
    prevNetTime = now;
    return result;
  } catch {
    return { net_in: null, net_out: null };
  }
}

function collectMetric() {
  const net = networkBytesPerSec();
  return {
    timestamp: new Date().toISOString(),
    cpu: round(cpuUsagePercent()),
    memory: round(memoryUsagePercent()),
    disk: round(diskUsagePercent('/')),
    net_in: round(net.net_in),
    net_out: round(net.net_out),
    load_avg: round(os.loadavg()[0]),
  };
}

function round(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

module.exports = { collectMetric };
