'use strict';
// Security event collection: tails auth logs and parses SSH / sudo / firewall events.
// Emits structured events via the provided callback. No passwords are ever captured.
const fs = require('fs');
const { spawn } = require('child_process');

const PATTERNS = [
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
    re: /Accepted password for (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'ssh_login',
      severity: 'low',
      username: m[1],
      source_ip: m[2],
      message: `Accepted SSH login for ${m[1]} from ${m[2]}`,
    }),
  },
  {
    re: /Accepted publickey for (\S+) from (\S+)/,
    build: (m) => ({
      event_type: 'ssh_login',
      severity: 'low',
      username: m[1],
      source_ip: m[2],
      message: `Accepted SSH publickey login for ${m[1]} from ${m[2]}`,
    }),
  },
  {
    re: /sudo:\s+(\S+)\s+:.*COMMAND=(.+)$/,
    build: (m) => ({
      event_type: 'sudo',
      severity: 'low',
      username: m[1],
      message: `sudo by ${m[1]}: ${m[2]}`,
    }),
  },
  {
    re: /\[UFW BLOCK\].*SRC=(\S+).*DST=(\S+).*(?:DPT=(\d+))?/,
    build: (m) => ({
      event_type: 'firewall_block',
      severity: 'medium',
      source_ip: m[1],
      message: `UFW blocked ${m[1]} -> ${m[2]}${m[3] ? ':' + m[3] : ''}`,
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
    // Follow new auth + sudo + kernel(ufw) entries.
    children.push(
      spawnTail(
        'journalctl',
        ['-f', '-n', '0', '-o', 'cat', '_COMM=sshd', '+', '_COMM=sudo', '+', '_TRANSPORT=kernel'],
        onEvent,
        'journalctl',
      ),
    );
  } else if (fs.existsSync(cfg.auth_log)) {
    children.push(spawnTail('tail', ['-F', '-n', '0', cfg.auth_log], onEvent, 'auth.log'));
  } else {
    console.warn('[security] no journald and auth_log missing; security collection disabled');
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
