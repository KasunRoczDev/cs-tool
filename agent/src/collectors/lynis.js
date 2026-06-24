'use strict';
// Lynis host-hardening audit → dashboard.
//
// `lynis audit system` writes a machine-readable report to
// /var/log/lynis-report.dat with lines like:
//   hardening_index=67
//   warning[]=AUTH-9286|Found one or more vulnerable packages|-|
//   suggestion[]=SSH-7408|Consider hardening SSH configuration|-|
//
// This collector (optionally) runs Lynis on a schedule, parses that report, and
// emits security_events — no DB schema change:
//   lynis_audit       (info)   one snapshot per run; hardening_index in raw
//   lynis_warning     (medium) one per warning[]
//   lynis_suggestion  (low)    one per suggestion[]
//
// Config (cfg.lynis):
//   { enabled: true, run: true, interval_hours: 24, run_timeout_sec: 900,
//     report_path: '/var/log/lynis-report.dat',
//     initial_delay_sec: 120, max_suggestions: 60 }
// Set run:false to only parse a report you generate yourself (e.g. cron).

const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_REPORT = '/var/log/lynis-report.dat';

function now() { return new Date().toISOString(); }

// Run `lynis audit system` non-blocking; callback(err) when finished/timed out.
function runLynis(timeoutMs, cb) {
  let child;
  try {
    child = spawn('lynis', ['audit', 'system', '--quick', '--no-colors'],
      { stdio: 'ignore' });
  } catch (e) { cb(e); return; }
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) {} }, timeoutMs);
  child.on('error', (e) => { clearTimeout(timer); cb(e); });
  // Parse the report regardless of exit code — Lynis may exit non-zero with findings.
  child.on('exit', () => { clearTimeout(timer); cb(null); });
}

// Parse a lynis-report.dat into { hardeningIndex, version, lastRun, warnings[], suggestions[] }.
// warning[]/suggestion[] values are pipe-delimited: TEST-ID|text|details|solution.
function parseReport(path) {
  const text = fs.readFileSync(path, 'utf8');
  const out = { hardeningIndex: null, version: null, lastRun: null, warnings: [], suggestions: [] };
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'hardening_index') out.hardeningIndex = Number(val);
    else if (key === 'lynis_version') out.version = val;
    else if (key === 'report_datetime_start') out.lastRun = val;
    else if (key === 'warning[]') out.warnings.push(splitFinding(val));
    else if (key === 'suggestion[]') out.suggestions.push(splitFinding(val));
  }
  return out;
}

function splitFinding(v) {
  const parts = String(v).split('|');
  return {
    test_id: (parts[0] || '').trim(),
    text: (parts[1] || '').trim(),
    details: (parts[2] || '').trim(),
    solution: (parts[3] || '').trim(),
  };
}

// Parse the report at `path` and emit events through onEvent.
function emitFromReport(cfg, onEvent) {
  const lc = (cfg && cfg.lynis) || {};
  const path = lc.report_path || DEFAULT_REPORT;
  if (!fs.existsSync(path)) {
    onEvent({ timestamp: now(), event_type: 'lynis_unavailable', severity: 'low',
      message: `Lynis report not found at ${path} — run "lynis audit system" or enable lynis.run`,
      raw: { report_path: path } });
    return;
  }
  let r;
  try { r = parseReport(path); }
  catch (e) {
    onEvent({ timestamp: now(), event_type: 'lynis_error', severity: 'low',
      message: `Failed to parse Lynis report: ${String(e.message).slice(0, 100)}`, raw: { report_path: path } });
    return;
  }

  // Snapshot: hardening index + counts (trends over time via event timestamps).
  onEvent({ timestamp: now(), event_type: 'lynis_audit', severity: 'info',
    message: `Lynis hardening index ${r.hardeningIndex ?? '?'} / 100 — ` +
      `${r.warnings.length} warning(s), ${r.suggestions.length} suggestion(s)`,
    raw: { hardening_index: r.hardeningIndex, warnings: r.warnings.length,
      suggestions: r.suggestions.length, version: r.version, last_run: r.lastRun, report_path: path } });

  // One event per warning (more severe) — cap to avoid floods.
  const maxW = lc.max_warnings || 100;
  for (const w of r.warnings.slice(0, maxW)) {
    onEvent({ timestamp: now(), event_type: 'lynis_warning', severity: 'medium',
      message: `[${w.test_id}] ${w.text}`,
      raw: { test_id: w.test_id, text: w.text, details: w.details, solution: w.solution } });
  }
  // Suggestions are advisory — low severity, larger but still capped.
  const maxS = lc.max_suggestions || 60;
  for (const s of r.suggestions.slice(0, maxS)) {
    onEvent({ timestamp: now(), event_type: 'lynis_suggestion', severity: 'low',
      message: `[${s.test_id}] ${s.text}`,
      raw: { test_id: s.test_id, text: s.text, details: s.details, solution: s.solution } });
  }
}

// One collection cycle: optionally run Lynis, then emit from the report.
function collectLynis(cfg, onEvent, done) {
  const lc = (cfg && cfg.lynis) || {};
  const finish = () => { try { emitFromReport(cfg, onEvent); } catch (_e) {} if (done) done(); };
  if (lc.run) {
    runLynis((lc.run_timeout_sec || 900) * 1000, (err) => {
      if (err) onEvent({ timestamp: now(), event_type: 'lynis_error', severity: 'low',
        message: `Lynis run failed: ${String(err.message).slice(0, 100)}`, raw: {} });
      finish();
    });
  } else {
    finish();
  }
}

// Schedule periodic audits. Returns a stop() function.
function startLynis(cfg, onEvent) {
  const lc = (cfg && cfg.lynis) || {};
  if (!lc.enabled) return () => {};
  const everyMs = (lc.interval_hours || 24) * 3600 * 1000;
  const kick = setTimeout(() => collectLynis(cfg, onEvent), (lc.initial_delay_sec || 120) * 1000);
  const timer = setInterval(() => collectLynis(cfg, onEvent), everyMs);
  console.log(`[lynis] enabled (run=${!!lc.run}, every ${lc.interval_hours || 24}h)`);
  return () => { clearTimeout(kick); clearInterval(timer); };
}

module.exports = { startLynis, collectLynis, parseReport, emitFromReport };
