'use strict';
// Security event collection: tails auth logs, syslog, and kern logs.
// Detects: SSH brute force, sudo, firewall, port scans, malware, SQL injection,
// XSS, privilege escalation, file integrity changes, suspicious processes, and more.
const fs = require('fs');
const { spawn } = require('child_process');

const PATTERNS = [
  // ── SSH ──────────────────────────────────────────────────────────────────
  {
    re: /Failed password for(?: invalid user)? (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'ssh_failed_login',
      severity: 'medium',
      username: m[1],
      source_ip: m[2],
      message: `Failed SSH login for ${m[1]} from ${m[2]}`,
    }),
  },
  {
    re: /Accepted (?:password|publickey) for (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'ssh_login',
      severity: 'low',
      username: m[1],
      source_ip: m[2],
      message: `SSH login accepted for ${m[1]} from ${m[2]}`,
    }),
  },
  {
    re: /Invalid user (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'ssh_failed_login',
      severity: 'medium',
      username: m[1],
      source_ip: m[2],
      message: `SSH invalid user ${m[1]} from ${m[2]}`,
    }),
  },
  {
    re: /error: maximum authentication attempts exceeded for(?: invalid user)? (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'brute_force',
      severity: 'high',
      username: m[1],
      source_ip: m[2],
      message: `SSH brute force: max auth attempts exceeded for ${m[1]} from ${m[2]}`,
    }),
  },

  // ── SUDO / PRIVILEGE ESCALATION ──────────────────────────────────────────
  {
    re: /sudo:\s+(\S+)\s+:.*COMMAND=(.+)$/,
    build: (m) => ({
      event_type: 'sudo',
      severity: 'low',
      username: m[1],
      message: `sudo by ${m[1]}: ${m[2].trim()}`,
    }),
  },
  {
    re: /sudo:\s+(\S+)\s+:.*authentication failure/,
    build: (m) => ({
      event_type: 'privilege_escalation',
      severity: 'high',
      username: m[1],
      message: `sudo authentication failure for ${m[1]}`,
    }),
  },
  {
    re: /su:\s+(?:FAILED SU|pam_unix.*authentication failure).*user=(\S+)/,
    build: (m) => ({
      event_type: 'privilege_escalation',
      severity: 'high',
      username: m[1],
      message: `su authentication failure for ${m[1]}`,
    }),
  },

  // ── FIREWALL ─────────────────────────────────────────────────────────────
  {
    re: /\[UFW BLOCK\].*SRC=(\S+).*DST=(\S+).*(?:DPT=(\d+))?/,
    build: (m) => ({
      event_type: 'firewall_block',
      severity: 'medium',
      source_ip: m[1],
      message: `UFW blocked ${m[1]} -> ${m[2]}${m[3] ? ':' + m[3] : ''}`,
    }),
  },
  {
    re: /iptables.*BLOCK.*SRC=(\S+)/,
    build: (m) => ({
      event_type: 'firewall_block',
      severity: 'medium',
      source_ip: m[1],
      message: `iptables blocked ${m[1]}`,
    }),
  },

  // ── PORT SCAN ────────────────────────────────────────────────────────────
  {
    re: /(?:nmap|port scan|SYN scan|XMAS scan|FIN scan|NULL scan).*from (\S+)/i,
    build: (m) => ({
      event_type: 'port_scan',
      severity: 'high',
      source_ip: m[1],
      message: `Port scan detected from ${m[1]}`,
    }),
  },

  // ── MALWARE / ROOTKIT ────────────────────────────────────────────────────
  {
    re: /(?:malware|trojan|virus|rootkit|rkhunter|chkrootkit).*(?:found|detected|warning)[:\s]+(.+)/i,
    build: (m) => ({
      event_type: 'malware',
      severity: 'critical',
      message: `Malware/rootkit detected: ${m[1].trim()}`,
    }),
  },
  {
    re: /rkhunter.*Warning.*'(.+)'/i,
    build: (m) => ({
      event_type: 'rootkit',
      severity: 'critical',
      message: `rkhunter warning: ${m[1]}`,
    }),
  },
  {
    re: /clamd.*FOUND\s+(.+)/,
    build: (m) => ({
      event_type: 'malware',
      severity: 'critical',
      message: `ClamAV detected: ${m[1].trim()}`,
    }),
  },

  // ── SQL INJECTION ────────────────────────────────────────────────────────
  {
    re: /(?:ModSecurity|mod_security|WAF).*(?:SQL[_ ]?[Ii]njection|id\s+942\d+)[^\n]*/,
    build: (m) => ({
      event_type: 'sql_injection',
      severity: 'critical',
      message: `WAF blocked SQL injection attempt`,
    }),
  },
  {
    re: /(?:UNION\s+SELECT|OR\s+1=1|DROP\s+TABLE|INSERT\s+INTO.*--)/i,
    build: (m) => ({
      event_type: 'sql_injection',
      severity: 'critical',
      message: `SQL injection payload detected in log`,
    }),
  },

  // ── XSS ──────────────────────────────────────────────────────────────────
  {
    re: /(?:ModSecurity|WAF).*(?:XSS|Cross.Site|id\s+941\d+)[^\n]*/i,
    build: (m) => ({
      event_type: 'xss',
      severity: 'high',
      message: `WAF blocked XSS attempt`,
    }),
  },

  // ── FILE INTEGRITY ───────────────────────────────────────────────────────
  {
    re: /(?:AIDE|aide|tripwire|Tripwire).*(?:changed|modified|added|removed)[:\s]+(.+)/i,
    build: (m) => ({
      event_type: 'file_integrity_change',
      severity: 'high',
      message: `File integrity change: ${m[1].trim()}`,
    }),
  },
  {
    re: /(?:inotifywait|auditd).*(?:WRITE|CREATE|DELETE|RENAME).*path=([^\s]+)/,
    build: (m) => ({
      event_type: 'file_integrity_change',
      severity: 'medium',
      message: `File system change detected: ${m[1]}`,
    }),
  },
  {
    re: /INTEGRITY.*FAIL.*file[:\s]+([^\n]+)/i,
    build: (m) => ({
      event_type: 'file_integrity_change',
      severity: 'critical',
      message: `Integrity check failure: ${m[1].trim()}`,
    }),
  },

  // ── SUSPICIOUS PROCESS ───────────────────────────────────────────────────
  {
    re: /(?:kernel|kauditd).*EXECVE.*a0="((?:nc|netcat|nmap|socat|wget|curl))".*a1="([^"]+)"/,
    build: (m) => ({
      event_type: 'suspicious_process',
      severity: 'high',
      message: `Suspicious process spawned: ${m[1]} ${m[2]}`,
    }),
  },

  // ── DATA EXFILTRATION / UNAUTHORIZED ACCESS ──────────────────────────────
  {
    re: /(?:unauthorized|UNAUTHORIZED).*access.*(?:from|by)\s+(\S+)/i,
    build: (m) => ({
      event_type: 'unauthorized_access',
      severity: 'high',
      source_ip: m[1],
      message: `Unauthorized access attempt from ${m[1]}`,
    }),
  },
  {
    re: /(?:auditd|audit).*type=SYSCALL.*comm="(?:scp|rsync|ftp|sftp)".*res=success/i,
    build: (m) => ({
      event_type: 'data_exfiltration',
      severity: 'high',
      message: `Possible data exfiltration via file transfer`,
    }),
  },

  // ── RANSOMWARE ───────────────────────────────────────────────────────────
  {
    re: /(?:ransomware|\.locked|\.encrypted|DECRYPT_INSTRUCTIONS|YOUR_FILES_ARE_ENCRYPTED)/i,
    build: (m) => ({
      event_type: 'ransomware',
      severity: 'critical',
      message: `Ransomware indicators detected`,
    }),
  },

  // ── DDoS ─────────────────────────────────────────────────────────────────
  {
    re: /(?:DDoS|flood attack|SYN flood|UDP flood).*from\s+(\S+)/i,
    build: (m) => ({
      event_type: 'ddos',
      severity: 'critical',
      source_ip: m[1],
      message: `DDoS/flood attack detected from ${m[1]}`,
    }),
  },
];

function parseLine(line, onEvent) {
  for (const p of PATTERNS) {
    const m = line.match(p.re);
    if (m) {
      onEvent({ timestamp: new Date().toISOString(), ...p.build(m) });
      return;
    }
  }
}

function spawnTail(cmd, args, onEvent, label) {
  let child;
  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    console.warn(`[security] cannot start ${label}: ${e.message}`);
    return null;
  }
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) parseLine(l, onEvent);
  });
  child.on('error', (e) => console.warn(`[security] ${label} error: ${e.message}`));
  child.on('exit', (code) =>
    console.warn(`[security] ${label} exited (${code})`),
  );
  return child;
}

/**
 * Start security log collection.
 * @param {object} cfg agent config
 * @param {(event:object)=>void} onEvent callback for each parsed event
 * @returns {()=>void} stop function
 */
function startSecurity(cfg, onEvent) {
  const children = [];
  const journald = cfg.use_journald && commandExists('journalctl');

  if (journald) {
    // Follow auth + sudo + kernel (UFW) + audit + security tools
    children.push(
      spawnTail(
        'journalctl',
        ['-f', '-n', '0', '-o', 'cat',
          '_COMM=sshd', '+', '_COMM=sudo', '+', '_COMM=su',
          '+', '_TRANSPORT=kernel', '+', 'SYSLOG_IDENTIFIER=clamd',
          '+', 'SYSLOG_IDENTIFIER=rkhunter', '+', 'SYSLOG_IDENTIFIER=aide',
          '+', '_COMM=auditd',
        ],
        onEvent,
        'journalctl',
      ),
    );
  } else {
    // Fall back to tailing flat log files
    const logFiles = [
      cfg.auth_log || '/var/log/auth.log',
      '/var/log/syslog',
      '/var/log/kern.log',
      '/var/log/audit/audit.log',
      '/var/log/apache2/error.log',
      '/var/log/nginx/error.log',
      '/var/log/modsec_audit.log',
    ];
    let gotOne = false;
    for (const path of logFiles) {
      if (fs.existsSync(path)) {
        children.push(spawnTail('tail', ['-F', '-n', '0', path], onEvent, path));
        gotOne = true;
      }
    }
    if (!gotOne) {
      console.warn('[security] no log files found; security collection disabled');
    }
  }

  return () => children.forEach((c) => c && c.kill());
}

function commandExists(cmd) {
  try {
    require('child_process').execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { startSecurity, parseLine };
