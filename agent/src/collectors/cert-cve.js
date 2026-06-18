'use strict';
// TLS certificate expiry + outbound-CVE checks.
// Emits events in the SAME shape your security collector uses, so they flow
// through the existing /api/v1/security-events ingestion untouched.
//
//   const { startCertCve } = require('./collectors/cert-cve');
//   const stop = startCertCve(cfg, onEvent);
//
// cfg.tls_targets: ["api.example.com:443", "dashboard.example.com:443"]
// cfg.cert_paths:  ["/etc/letsencrypt/live/example.com/cert.pem"]  (local files)

const { execSync } = require('child_process');
const fs = require('fs');

const DAY = 86400;

// ── Remote TLS endpoint expiry (one of the most common real outages) ────────
function checkRemoteCert(target, onEvent) {
  const [host, port = '443'] = target.split(':');
  try {
    const out = execSync(
      `echo | timeout 8 openssl s_client -servername ${host} -connect ${host}:${port} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 },
    );
    const m = out.match(/notAfter=(.+)/);
    if (!m) {
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: 'tls_cert_error',
        severity: 'high',
        message: `Could not read TLS certificate for ${target}`,
        raw: { target },
      });
      return;
    }
    emitCertEvent(target, new Date(m[1].trim()), onEvent);
  } catch (e) {
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'tls_cert_error',
      severity: 'high',
      message: `TLS handshake failed for ${target}: ${String(e.message).slice(0, 80)}`,
      raw: { target },
    });
  }
}

// ── Local cert file expiry (Let's Encrypt / nginx certs on disk) ────────────
function checkLocalCert(path, onEvent) {
  try {
    if (!fs.existsSync(path)) return;
    const out = execSync(`openssl x509 -enddate -noout -in "${path}" 2>/dev/null`, {
      encoding: 'utf8', timeout: 5000,
    });
    const m = out.match(/notAfter=(.+)/);
    if (m) emitCertEvent(path, new Date(m[1].trim()), onEvent);
  } catch { /* unreadable cert */ }
}

function emitCertEvent(label, notAfter, onEvent) {
  const daysLeft = Math.round((notAfter.getTime() - Date.now()) / 1000 / DAY);
  let severity = null;
  if (daysLeft < 0) severity = 'critical';
  else if (daysLeft <= 7) severity = 'critical';
  else if (daysLeft <= 14) severity = 'high';
  else if (daysLeft <= 30) severity = 'medium';
  // Always emit a snapshot so the dashboard can show the runway; severity 'low' if healthy.
  onEvent({
    timestamp: new Date().toISOString(),
    event_type: daysLeft < 0 ? 'tls_cert_expired' : 'tls_cert_expiry',
    severity: severity || 'low',
    message: daysLeft < 0
      ? `TLS certificate for ${label} EXPIRED ${-daysLeft} day(s) ago`
      : `TLS certificate for ${label} expires in ${daysLeft} day(s) (${notAfter.toISOString().slice(0, 10)})`,
    raw: { target: label, days_left: daysLeft, not_after: notAfter.toISOString() },
  });
}

// ── Node dependency CVE check via `npm audit` (SCA) ─────────────────────────
function checkNpmAudit(projectDir, onEvent) {
  try {
    const out = execSync('npm audit --json 2>/dev/null', {
      cwd: projectDir, encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(out);
    const v = data.metadata?.vulnerabilities || {};
    const critical = v.critical || 0;
    const high = v.high || 0;
    if (critical + high === 0) return;
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'dependency_vulnerability',
      severity: critical > 0 ? 'critical' : 'high',
      message: `npm audit: ${critical} critical, ${high} high vulnerabilities in ${projectDir}`,
      raw: { dir: projectDir, vulnerabilities: v },
    });
  } catch (e) {
    // npm audit exits non-zero when vulns exist; stdout still holds JSON
    try {
      const data = JSON.parse(e.stdout || '{}');
      const v = data.metadata?.vulnerabilities || {};
      if ((v.critical || 0) + (v.high || 0) > 0) {
        onEvent({
          timestamp: new Date().toISOString(),
          event_type: 'dependency_vulnerability',
          severity: v.critical > 0 ? 'critical' : 'high',
          message: `npm audit: ${v.critical || 0} critical, ${v.high || 0} high vulnerabilities in ${projectDir}`,
          raw: { dir: projectDir, vulnerabilities: v },
        });
      }
    } catch { /* not a node project */ }
  }
}

// ── Pending OS security updates (unpatched-CVE exposure) ─────────────────────
function checkOsUpdates(onEvent) {
  try {
    const out = execSync(
      "apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -ci '^Inst.*security' || true",
      { encoding: 'utf8', timeout: 15000, shell: '/bin/bash' },
    );
    const secCount = Number(out.trim()) || 0;
    if (secCount > 0) {
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: 'os_security_updates_pending',
        severity: secCount > 10 ? 'high' : 'medium',
        message: `${secCount} OS security update(s) pending — unpatched CVE exposure`,
        raw: { pending_security_updates: secCount },
      });
    }
  } catch { /* not apt-based */ }
}

function startCertCve(cfg, onEvent) {
  const run = () => {
    (cfg.tls_targets || []).forEach((t) => checkRemoteCert(t, onEvent));
    (cfg.cert_paths || []).forEach((p) => checkLocalCert(p, onEvent));
    (cfg.audit_dirs || []).forEach((d) => checkNpmAudit(d, onEvent));
    checkOsUpdates(onEvent);
  };
  run(); // immediate first pass
  // Certs/CVEs change slowly — every 6h is plenty and keeps load near zero.
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  return () => clearInterval(timer);
}

module.exports = { startCertCve, checkRemoteCert, checkLocalCert, emitCertEvent };
