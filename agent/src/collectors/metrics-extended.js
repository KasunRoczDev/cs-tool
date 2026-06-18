'use strict';
// Extended system metrics — the "silent killers" the base collector doesn't cover.
// Additive: import alongside collectMetric() and merge the result, or send as a
// separate metric payload. Pure /proc + cheap shell, same style as metrics.js.
//
//   const { collectExtendedMetric } = require('./collectors/metrics-extended');
//   const m = { ...collectMetric(), ...collectExtendedMetric() };
//
// Every field degrades to null on unsupported kernels so ingestion never breaks.

const fs = require('fs');
const { execSync } = require('child_process');

let prevDiskIo = null;
let prevDiskIoTime = null;

function round(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function readMeminfo() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number(info.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
    return { get };
  } catch {
    return null;
  }
}

// ── Swap usage % — swap thrashing = severe latency before OOM ───────────────
function swapUsagePercent() {
  const mi = readMeminfo();
  if (!mi) return null;
  const total = mi.get('SwapTotal');
  const free = mi.get('SwapFree');
  if (!total) return 0; // no swap configured
  return ((total - free) / total) * 100;
}

// ── Inode usage % — disk can be "empty" yet fail to create files ────────────
function inodeUsagePercent(mount = '/') {
  try {
    const out = execSync(`df -iP ${mount} | tail -1`, { encoding: 'utf8', timeout: 4000 });
    const pct = out.trim().split(/\s+/)[4];
    return Number(String(pct).replace('%', ''));
  } catch {
    return null;
  }
}

// ── Disk I/O — sectors read/written per second across real block devices ────
// Slow disk shows up here long before it shows up as CPU iowait alerts.
function diskIoPerSec() {
  try {
    const lines = fs.readFileSync('/proc/diskstats', 'utf8').split('\n');
    let readSectors = 0;
    let writeSectors = 0;
    let ioInProgress = 0;
    for (const l of lines) {
      const c = l.trim().split(/\s+/);
      if (c.length < 14) continue;
      const dev = c[2];
      // skip partitions (sda1) and virtual loop/ram devices; keep whole disks
      if (/\d$/.test(dev) || /^(loop|ram|fd)/.test(dev)) continue;
      readSectors += Number(c[5]);  // sectors read
      writeSectors += Number(c[9]); // sectors written
      ioInProgress += Number(c[11]); // I/Os currently in progress (queue depth)
    }
    const now = Date.now();
    if (!prevDiskIo) {
      prevDiskIo = { readSectors, writeSectors };
      prevDiskIoTime = now;
      return { disk_read_bps: null, disk_write_bps: null, disk_io_queue: ioInProgress };
    }
    const dt = (now - prevDiskIoTime) / 1000 || 1;
    const SECTOR = 512;
    const result = {
      disk_read_bps: Math.max(0, ((readSectors - prevDiskIo.readSectors) * SECTOR) / dt),
      disk_write_bps: Math.max(0, ((writeSectors - prevDiskIo.writeSectors) * SECTOR) / dt),
      disk_io_queue: ioInProgress,
    };
    prevDiskIo = { readSectors, writeSectors };
    prevDiskIoTime = now;
    return result;
  } catch {
    return { disk_read_bps: null, disk_write_bps: null, disk_io_queue: null };
  }
}

// ── conntrack saturation — table full = silently dropped connections ────────
function conntrackPercent() {
  try {
    const count = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_count', 'utf8').trim());
    const max = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_max', 'utf8').trim());
    if (!max) return null;
    return (count / max) * 100;
  } catch {
    return null; // conntrack module not loaded
  }
}

// ── File descriptor usage % — high-connection servers die here first ────────
function fileDescriptorPercent() {
  try {
    const [allocated, , max] = fs.readFileSync('/proc/sys/fs/file-nr', 'utf8')
      .trim().split(/\s+/).map(Number);
    if (!max) return null;
    return (allocated / max) * 100;
  } catch {
    return null;
  }
}

// ── TCP connection states — TIME_WAIT pileups, SYN floods, conn exhaustion ──
function tcpConnectionStates() {
  try {
    const out = execSync('ss -tan 2>/dev/null', { encoding: 'utf8', timeout: 4000 });
    const states = { ESTAB: 0, TIME_WAIT: 0, CLOSE_WAIT: 0, SYN_RECV: 0, LISTEN: 0 };
    for (const line of out.split('\n').slice(1)) {
      const st = line.trim().split(/\s+/)[0];
      if (st in states) states[st] += 1;
    }
    return {
      tcp_established: states.ESTAB,
      tcp_time_wait: states.TIME_WAIT,
      tcp_close_wait: states.CLOSE_WAIT,
      tcp_syn_recv: states.SYN_RECV, // sustained high = SYN flood
    };
  } catch {
    return { tcp_established: null, tcp_time_wait: null, tcp_close_wait: null, tcp_syn_recv: null };
  }
}

// ── Process & thread count — fork bombs, zombie pileups ─────────────────────
function processStats() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const procsRunning = Number(stat.match(/procs_running\s+(\d+)/)?.[1] ?? 0);
    let total = 0;
    let zombies = 0;
    const pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
    total = pids.length;
    for (const pid of pids) {
      try {
        const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        // state is the char after the comm field in parentheses
        const state = s.slice(s.lastIndexOf(')') + 2)[0];
        if (state === 'Z') zombies += 1;
      } catch { /* process gone */ }
    }
    return { proc_total: total, proc_running: procsRunning, proc_zombie: zombies };
  } catch {
    return { proc_total: null, proc_running: null, proc_zombie: null };
  }
}

// ── Load averages (5/15 min) + per-core normalisation ───────────────────────
function loadAverages() {
  try {
    const [l1, l5, l15] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number);
    const cores = require('os').cpus().length || 1;
    return {
      load_avg_5: l5,
      load_avg_15: l15,
      // >1.0 means demand exceeds available cores
      load_per_core: round(l1 / cores),
    };
  } catch {
    return { load_avg_5: null, load_avg_15: null, load_per_core: null };
  }
}

// ── Uptime — detects unexpected reboots (crash/attack) between samples ───────
function uptimeSeconds() {
  try {
    return Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0]));
  } catch {
    return null;
  }
}

// ── NTP/time drift — breaks TLS, auth, log correlation when it slips ─────────
// Returns absolute offset in milliseconds vs reference, or null if unavailable.
function timeDriftMs() {
  try {
    // chrony preferred; fall back to timedatectl sync state
    const out = execSync('chronyc tracking 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const m = out.match(/System time\s+:\s+([\d.]+)\s+seconds/);
    if (m) return round(Number(m[1]) * 1000);
    return null;
  } catch {
    try {
      const out = execSync('timedatectl show -p NTPSynchronized --value 2>/dev/null', {
        encoding: 'utf8', timeout: 3000,
      }).trim();
      // not a drift figure, but flags desync: return large sentinel if not synced
      return out === 'yes' ? 0 : null;
    } catch {
      return null;
    }
  }
}

function collectExtendedMetric() {
  const io = diskIoPerSec();
  const tcp = tcpConnectionStates();
  const procs = processStats();
  const load = loadAverages();
  return {
    timestamp: new Date().toISOString(),
    swap: round(swapUsagePercent()),
    inode: round(inodeUsagePercent('/')),
    disk_read_bps: round(io.disk_read_bps),
    disk_write_bps: round(io.disk_write_bps),
    disk_io_queue: io.disk_io_queue,
    conntrack: round(conntrackPercent()),
    fd_usage: round(fileDescriptorPercent()),
    ...tcp,
    ...procs,
    ...load,
    uptime: uptimeSeconds(),
    time_drift_ms: timeDriftMs(),
  };
}

// Wrap the extended metric as a single security-event so it shows in the
// dashboard without adding columns to the metrics table. raw holds every field.
function collectExtendedAsEvent() {
  const m = collectExtendedMetric();
  const flags = [];
  if (m.swap != null && m.swap >= 25) flags.push(`swap ${m.swap}%`);
  if (m.conntrack != null && m.conntrack >= 70) flags.push(`conntrack ${m.conntrack}%`);
  if (m.fd_usage != null && m.fd_usage >= 70) flags.push(`fd ${m.fd_usage}%`);
  if (m.tcp_syn_recv != null && m.tcp_syn_recv >= 256) flags.push(`SYN_RECV ${m.tcp_syn_recv}`);
  if (m.proc_zombie != null && m.proc_zombie >= 20) flags.push(`${m.proc_zombie} zombies`);
  const severity = flags.length ? 'medium' : 'info';
  return {
    timestamp: m.timestamp,
    event_type: 'system_extended_snapshot',
    severity,
    message: flags.length
      ? `Extended host metrics — attention: ${flags.join(', ')}`
      : `Extended host metrics snapshot (swap ${m.swap}%, conntrack ${m.conntrack ?? 'n/a'}%, fd ${m.fd_usage}%)`,
    raw: m,
  };
}

module.exports = {
  collectExtendedMetric,
  collectExtendedAsEvent,
  // exported individually for unit tests / selective use
  swapUsagePercent,
  inodeUsagePercent,
  diskIoPerSec,
  conntrackPercent,
  fileDescriptorPercent,
  tcpConnectionStates,
  processStats,
};
