'use strict';
// Security event collection: tails auth logs, syslog, kern logs, and nginx access logs.
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// ── Syslog / auth patterns ────────────────────────────────────────────────
const PATTERNS = [
  {
    re: /Failed password for(?: invalid user)? (\S+) from (\S+)/,
    build: (m) => ({ event_type: 'ssh_failed_login', severity: 'medium', username: m[1], source_ip: m[2],
      message: `Failed SSH login for ${m[1]} from ${m[2]}` }),
  },
  {
    re: /Accepted (?:password|publickey) for (\S+) from (\S+)/,
    build: (m) => ({ event_type: 'ssh_login', severity: 'low', username: m[1], source_ip: m[2],
      message: `SSH login accepted for ${m[1]} from ${m[2]}` }),
  },
  {
    re: /Invalid user (\S+) from (\S+)/,
    build: (m) => ({ event_type: 'ssh_failed_login', severity: 'medium', username: m[1], source_ip: m[2],
      message: `SSH invalid user ${m[1]} from ${m[2]}` }),
  },
  {
    re: /error: maximum authentication attempts exceeded for(?: invalid user)? (\S+) from (\S+)/,
    build: (m) => ({ event_type: 'brute_force', severity: 'high', username: m[1], source_ip: m[2],
      message: `SSH brute force max auth attempts exceeded for ${m[1]} from ${m[2]}` }),
  },
  {
    re: /sudo:\s+(\S+)\s+:.*COMMAND=(.+)$/,
    build: (m) => ({ event_type: 'sudo', severity: 'low', username: m[1],
      message: `sudo by ${m[1]}: ${m[2].trim()}` }),
  },
  {
    re: /sudo:\s+(\S+)\s+:.*authentication failure/,
    build: (m) => ({ event_type: 'privilege_escalation', severity: 'high', username: m[1],
      message: `sudo authentication failure for ${m[1]}` }),
  },
  {
    re: /su:\s+(?:FAILED SU|pam_unix.*authentication failure).*user=(\S+)/,
    build: (m) => ({ event_type: 'privilege_escalation', severity: 'high', username: m[1],
      message: `su authentication failure for ${m[1]}` }),
  },
  {
    re: /\[UFW BLOCK\].*SRC=(\S+).*DST=(\S+).*(?:DPT=(\d+))?/,
    build: (m) => ({ event_type: 'firewall_block', severity: 'medium', source_ip: m[1],
      message: `UFW blocked ${m[1]} -> ${m[2]}${m[3] ? ':' + m[3] : ''}` }),
  },
  {
    re: /iptables.*BLOCK.*SRC=(\S+)/,
    build: (m) => ({ event_type: 'firewall_block', severity: 'medium', source_ip: m[1],
      message: `iptables blocked ${m[1]}` }),
  },
  {
    re: /(?:nmap|port scan|SYN scan|XMAS scan|FIN scan|NULL scan).*from (\S+)/i,
    build: (m) => ({ event_type: 'port_scan', severity: 'high', source_ip: m[1],
      message: `Port scan detected from ${m[1]}` }),
  },
  {
    re: /(?:malware|trojan|virus|rootkit|rkhunter|chkrootkit).*(?:found|detected|warning)[:\s]+(.+)/i,
    build: (m) => ({ event_type: 'malware', severity: 'critical',
      message: `Malware/rootkit detected: ${m[1].trim()}` }),
  },
  {
    re: /rkhunter.*Warning.*'(.+)'/i,
    build: (m) => ({ event_type: 'rootkit', severity: 'critical',
      message: `rkhunter warning: ${m[1]}` }),
  },
  {
    re: /clamd.*FOUND\s+(.+)/,
    build: (m) => ({ event_type: 'malware', severity: 'critical',
      message: `ClamAV detected: ${m[1].trim()}` }),
  },
  {
    re: /(?:ModSecurity|mod_security|WAF).*(?:SQL[_ ]?[Ii]njection|id\s+942\d+)[^\n]*/,
    build: () => ({ event_type: 'sql_injection', severity: 'critical',
      message: 'WAF blocked SQL injection attempt' }),
  },
  {
    re: /(?:UNION\s+SELECT|OR\s+1=1|DROP\s+TABLE|INSERT\s+INTO.*--)/i,
    build: () => ({ event_type: 'sql_injection', severity: 'critical',
      message: 'SQL injection payload detected in log' }),
  },
  {
    re: /(?:ModSecurity|WAF).*(?:XSS|Cross.Site|id\s+941\d+)[^\n]*/i,
    build: () => ({ event_type: 'xss', severity: 'high', message: 'WAF blocked XSS attempt' }),
  },
  {
    re: /(?:AIDE|aide|tripwire|Tripwire).*(?:changed|modified|added|removed)[:\s]+(.+)/i,
    build: (m) => ({ event_type: 'file_integrity_change', severity: 'high',
      message: `File integrity change: ${m[1].trim()}` }),
  },
  {
    re: /(?:inotifywait|auditd).*(?:WRITE|CREATE|DELETE|RENAME).*path=([^\s]+)/,
    build: (m) => ({ event_type: 'file_integrity_change', severity: 'medium',
      message: `File system change detected: ${m[1]}` }),
  },
  {
    re: /INTEGRITY.*FAIL.*file[:\s]+([^\n]+)/i,
    build: (m) => ({ event_type: 'file_integrity_change', severity: 'critical',
      message: `Integrity check failure: ${m[1].trim()}` }),
  },
  {
    re: /(?:kernel|kauditd).*EXECVE.*a0="((?:nc|netcat|nmap|socat|wget|curl))".*a1="([^"]+)"/,
    build: (m) => ({ event_type: 'suspicious_process', severity: 'high',
      message: `Suspicious process spawned: ${m[1]} ${m[2]}` }),
  },
  {
    re: /(?:unauthorized|UNAUTHORIZED).*access.*(?:from|by)\s+(\S+)/i,
    build: (m) => ({ event_type: 'unauthorized_access', severity: 'high', source_ip: m[1],
      message: `Unauthorized access attempt from ${m[1]}` }),
  },
  {
    re: /(?:auditd|audit).*type=SYSCALL.*comm="(?:scp|rsync|ftp|sftp)".*res=success/i,
    build: () => ({ event_type: 'data_exfiltration', severity: 'high',
      message: 'Possible data exfiltration via file transfer' }),
  },
  {
    re: /(?:ransomware|\.locked|\.encrypted|DECRYPT_INSTRUCTIONS|YOUR_FILES_ARE_ENCRYPTED)/i,
    build: () => ({ event_type: 'ransomware', severity: 'critical', message: 'Ransomware indicators detected' }),
  },
  {
    re: /(?:DDoS|flood attack|SYN flood|UDP flood).*from\s+(\S+)/i,
    build: (m) => ({ event_type: 'ddos', severity: 'critical', source_ip: m[1],
      message: `DDoS/flood attack detected from ${m[1]}` }),
  },
];

// ── Nginx access log parser ───────────────────────────────────────────────
const NGINX_ACCESS_RE = /^(\S+) - \S+ \[[^\]]+\] "([A-Z]+) ([^\s"]*) HTTP\/[\d.]+"\s+(\d{3})\s+\d+\s+"[^"]*"\s+"([^"]*)"/;

const DANGEROUS_PATHS = [
  { re: /(?:\.\.\/|\.\.\\|%2e%2e|%252e)/i,               type: 'nginx_path_traversal', severity: 'high',     label: 'Path traversal' },
  { re: /\/\.env(?:\b|$)/,                                 type: 'nginx_exploit_probe', severity: 'critical', label: '.env file probe' },
  { re: /\/\.git\//,                                       type: 'nginx_exploit_probe', severity: 'critical', label: '.git directory probe' },
  { re: /\/(?:wp-login|wp-admin|xmlrpc)\.php/i,           type: 'nginx_exploit_probe', severity: 'high',     label: 'WordPress attack probe' },
  { re: /\/(?:phpMyAdmin|phpmyadmin|pma)\//i,             type: 'nginx_exploit_probe', severity: 'high',     label: 'phpMyAdmin probe' },
  { re: /\/(?:shell|cmd|exec|eval)(?:\.php|\.asp|\?)/i,   type: 'nginx_exploit_probe', severity: 'critical', label: 'Shell/RCE probe' },
  { re: /(?:etc\/passwd|etc\/shadow|proc\/self)/i,        type: 'nginx_exploit_probe', severity: 'critical', label: 'System file probe' },
  { re: /wp-config\.php/i,                                type: 'nginx_exploit_probe', severity: 'critical', label: 'WordPress config probe' },
  { re: /(?:union[\s+%20]+select|drop[\s+%20]+table)/i,   type: 'sql_injection',       severity: 'critical', label: 'SQL injection in URL' },
  { re: /(?:<script|javascript:|onerror\s*=|onload\s*=)/i, type: 'xss',               severity: 'high',     label: 'XSS attempt in URL' },
  { re: /\/(?:cgi-bin|cgi)\/\S+\.(?:pl|sh|cgi)/i,        type: 'nginx_exploit_probe', severity: 'medium',  label: 'CGI script probe' },
  { re: /\.(bak|backup|old|sql|dump|tar\.gz)(\?|$)/i,    type: 'nginx_exploit_probe', severity: 'medium',  label: 'Backup file probe' },
  { re: /\/(?:actuator|metrics|health|env|info|mappings)\b/, type: 'nginx_exploit_probe', severity: 'high', label: 'Spring Actuator probe' },
];

const SCANNER_UA_RE = /(?:zgrab|masscan|sqlmap|nikto|nessus|openvas|dirbuster|gobuster|wfuzz|nuclei|acunetix|nmap|python-requests\/[0-2]\.|libwww-perl|curl\/[0-7]\.|scrapy|harvester)/i;

// Requests slower than this (seconds) are surfaced as bottlenecks. Needs nginx
// log_format to append the request time, e.g.:
//   log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
//                    '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
//                    'rt=$request_time urt=$upstream_response_time';
const SLOW_REQUEST_SECONDS = Number(process.env.MONITOR_NGINX_SLOW_SECONDS) || 1.0;

function parseNginxAccessLine(line, onEvent) {
  const m = line.match(NGINX_ACCESS_RE);
  if (!m) return;
  const [, ip, method, rawPath, statusStr, ua] = m;
  const status = parseInt(statusStr, 10);
  const path = rawPath.substring(0, 300);

  // Slow-request bottleneck: the real "which endpoint is killing us" signal.
  // request_time is end-to-end; upstream_response_time is the PHP-FPM portion.
  const rtm = line.match(/\brt=(\d+(?:\.\d+)?)/);
  if (rtm) {
    const rt = parseFloat(rtm[1]);
    if (rt >= SLOW_REQUEST_SECONDS) {
      const urtm = line.match(/\burt=(\d+(?:\.\d+)?)/);
      // Optional POST body, IF nginx log_format adds body="$request_body". This is
      // the only way (without touching the PHP app) to tell apart POST /index.php
      // actions whose route lives in the form body. Captured quoted or bare.
      const bm = line.match(/\bbody="([^"]*)"/) || line.match(/\bbody=(\S+)/);
      const body = bm ? bm[1].slice(0, 300) : null;
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: 'nginx_slow_request',
        severity: rt >= 5 ? 'high' : rt >= 2 ? 'medium' : 'low',
        source_ip: ip,
        message: 'Slow request ' + rt + 's: ' + method + ' ' + path.substring(0, 140) + ' (HTTP ' + status + ')',
        raw: { method, path, status, request_time: rt, upstream_time: urtm ? parseFloat(urtm[1]) : null, body },
      });
    }
  }

  for (const dp of DANGEROUS_PATHS) {
    if (dp.re.test(path)) {
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: dp.type,
        severity: dp.severity,
        source_ip: ip,
        message: dp.label + ': ' + method + ' ' + path.substring(0, 120) + ' (HTTP ' + status + ')',
        raw: { method, path, status, user_agent: ua.substring(0, 250) },
      });
      return;
    }
  }

  if (SCANNER_UA_RE.test(ua)) {
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'nginx_scan',
      severity: 'medium',
      source_ip: ip,
      message: 'Scanner/bot UA: ' + ua.substring(0, 100) + ' -> ' + method + ' ' + path.substring(0, 80),
      raw: { method, path, status, user_agent: ua.substring(0, 250) },
    });
    return;
  }

  if (status >= 500 && ip !== '127.0.0.1' && ip !== '::1') {
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'nginx_server_error',
      severity: 'medium',
      source_ip: ip,
      message: 'HTTP ' + status + ': ' + method + ' ' + path.substring(0, 100),
      raw: { method, path, status, user_agent: ua.substring(0, 250) },
    });
  }
}

// ── Open ports periodic check ─────────────────────────────────────────────
const DANGEROUS_PORTS = {
  3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 27017: 'MongoDB',
  9200: 'Elasticsearch', 9300: 'Elasticsearch cluster',
  2181: 'Zookeeper', 11211: 'Memcached',
  2375: 'Docker daemon (unencrypted)', 2376: 'Docker daemon TLS',
  8500: 'Consul', 5672: 'RabbitMQ', 15672: 'RabbitMQ mgmt UI',
  9042: 'Cassandra',
};

function checkOpenPorts(onEvent) {
  try {
    let output = '';
    try { output = execSync('ss -tlnp 2>/dev/null', { timeout: 5000 }).toString(); }
    catch (_e) { output = execSync('netstat -tlnp 2>/dev/null', { timeout: 5000 }).toString(); }
    const portSet = new Set();
    const portRe = /[:\s](\d{2,5})\s+/g;
    let mm;
    while ((mm = portRe.exec(output)) !== null) {
      const p = parseInt(mm[1]);
      if (p > 0 && p < 65536) portSet.add(p);
    }
    const ports = Array.from(portSet).sort(function(a,b){ return a-b; });
    const exposed = ports.filter(function(p){ return DANGEROUS_PORTS[p]; });
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'open_ports_snapshot',
      severity: exposed.length > 0 ? 'high' : 'low',
      message: exposed.length > 0
        ? 'Dangerous services exposed: ' + exposed.map(function(p){ return p + '/' + DANGEROUS_PORTS[p]; }).join(', ')
        : 'Open ports snapshot: ' + ports.slice(0, 20).join(', '),
      raw: {
        all_ports: ports,
        dangerous_exposed: exposed.map(function(p){ return { port: p, service: DANGEROUS_PORTS[p] }; }),
      },
    });
  } catch (_e) { /* ss/netstat unavailable */ }
}

// ── Firewall status check ─────────────────────────────────────────────────
function checkFirewallStatus(onEvent) {
  try {
    const out = execSync('ufw status 2>/dev/null', { timeout: 4000 }).toString();
    if (!/Status:\s+active/i.test(out)) {
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: 'firewall_disabled',
        severity: 'critical',
        message: 'UFW firewall is INACTIVE — no firewall protection',
        raw: { tool: 'ufw', status: 'inactive' },
      });
      return;
    }
    const rules = [];
    const ruleRe = /^([\w/]+)\s+ALLOW IN\b/gm;
    let mm;
    while ((mm = ruleRe.exec(out)) !== null) rules.push(mm[1]);
    onEvent({
      timestamp: new Date().toISOString(),
      event_type: 'firewall_status_snapshot',
      severity: 'low',
      message: 'UFW active. Allowed inbound: ' + (rules.join(', ') || 'none listed'),
      raw: { tool: 'ufw', active: true, allowed_rules: rules },
    });
    return;
  } catch (_e) { /* ufw not available */ }

  try {
    const out = execSync('iptables -L INPUT --line-numbers -n 2>/dev/null | head -4', { timeout: 4000 }).toString();
    if (!/policy DROP/i.test(out)) {
      onEvent({
        timestamp: new Date().toISOString(),
        event_type: 'firewall_weak',
        severity: 'high',
        message: 'iptables INPUT policy is not DROP — firewall may be permissive',
        raw: { tool: 'iptables', chain_head: out.substring(0, 300) },
      });
    }
    return;
  } catch (_e) { /* iptables not available */ }

  onEvent({
    timestamp: new Date().toISOString(),
    event_type: 'firewall_disabled',
    severity: 'critical',
    message: 'No firewall detected (UFW not installed, iptables unavailable)',
    raw: { tool: 'none' },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function parseLine(line, onEvent) {
  for (const p of PATTERNS) {
    const m = line.match(p.re);
    if (m) {
      onEvent({ timestamp: new Date().toISOString(), ...p.build(m) });
      return;
    }
  }
}

function spawnTail(cmd, args, onEvent, label, lineParser) {
  const parser = lineParser || parseLine;
  let child;
  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    console.warn('[security] cannot start ' + label + ': ' + e.message);
    return null;
  }
  let buf = '';
  child.stdout.on('data', function(chunk) {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) parser(l, onEvent);
  });
  child.on('error', function(e) { console.warn('[security] ' + label + ' error: ' + e.message); });
  child.on('exit', function(code) { console.warn('[security] ' + label + ' exited (' + code + ')'); });
  return child;
}

function commandExists(cmd) {
  try { execSync('command -v ' + cmd, { stdio: 'ignore' }); return true; }
  catch (_e) { return false; }
}

function startSecurity(cfg, onEvent) {
  const children = [];
  const timers   = [];
  const journald = cfg.use_journald && commandExists('journalctl');

  if (journald) {
    children.push(spawnTail(
      'journalctl',
      ['-f', '-n', '0', '-o', 'cat',
        '_COMM=sshd', '+', '_COMM=sudo', '+', '_COMM=su',
        '+', '_TRANSPORT=kernel', '+', 'SYSLOG_IDENTIFIER=clamd',
        '+', 'SYSLOG_IDENTIFIER=rkhunter', '+', 'SYSLOG_IDENTIFIER=aide',
        '+', '_COMM=auditd',
      ],
      onEvent, 'journalctl',
    ));
  } else {
    const syslogFiles = [
      cfg.auth_log || '/var/log/auth.log',
      '/var/log/syslog', '/var/log/kern.log',
      '/var/log/audit/audit.log', '/var/log/apache2/error.log',
      '/var/log/nginx/error.log', '/var/log/modsec_audit.log',
    ];
    let gotOne = false;
    for (const logPath of syslogFiles) {
      if (fs.existsSync(logPath)) {
        children.push(spawnTail('tail', ['-F', '-n', '0', logPath], onEvent, logPath));
        gotOne = true;
      }
    }
    if (!gotOne) console.warn('[security] no syslog files found; security collection disabled');
  }

  const nginxCandidates = [cfg.nginx_access_log, '/var/log/nginx/access.log'].filter(Boolean);
  for (const logPath of nginxCandidates) {
    if (fs.existsSync(logPath)) {
      children.push(spawnTail('tail', ['-F', '-n', '0', logPath], onEvent, 'nginx:' + logPath, parseNginxAccessLine));
      console.log('[security] tailing nginx access log: ' + logPath);
      break;
    }
  }

  checkOpenPorts(onEvent);
  timers.push(setInterval(function() { checkOpenPorts(onEvent); }, 5 * 60 * 1000));

  checkFirewallStatus(onEvent);
  timers.push(setInterval(function() { checkFirewallStatus(onEvent); }, 15 * 60 * 1000));

  return function() {
    children.forEach(function(c) { if (c) c.kill(); });
    timers.forEach(function(t) { clearInterval(t); });
  };
}

module.exports = { startSecurity, parseLine, parseNginxAccessLine };
