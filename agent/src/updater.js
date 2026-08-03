'use strict';
// Self-update checker. Runs on an interval alongside the metrics/security
// loops (agent/src/index.js). It only checks, downloads, and verifies — the
// actual install/restart/health-check/rollback is done by a root-run script
// (agent/scripts/apply-update.sh) invoked via a narrowly-scoped sudo rule,
// so the hardened, unprivileged main agent process never needs write access
// to /usr/lib or the ability to restart systemd units.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { verifyPackage } = require('./update/verify');

const DEFAULT_PUBLIC_KEY_PATH = '/etc/monitor-agent/update-signing-pub.pem';
const APPLY_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'apply-update.sh');

class Updater {
  constructor(cfg) {
    this.cfg = cfg;
    this.scfg = cfg.self_update || {};
    this.serverUrl = cfg.server_url.replace(/\/$/, '');
    this.apiKey = cfg.api_key;
    this.currentVersion = require('../package.json').version;
    this.updatesDir = this.scfg.updates_dir || '/var/lib/monitor-agent/updates';
    this.publicKeyPath = this.scfg.public_key_path || DEFAULT_PUBLIC_KEY_PATH;
  }

  async _get(pathName) {
    const res = await fetch(this.serverUrl + pathName, { headers: { 'X-Api-Key': this.apiKey } });
    if (!res.ok) throw new Error(`${pathName} -> HTTP ${res.status}`);
    return res.json();
  }

  async _report(body) {
    try {
      await fetch(this.serverUrl + '/api/v1/agent/updates/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.warn(`[updater] report failed: ${e.message}`);
    }
  }

  /** One check cycle: ask the platform, and if eligible for a genuinely new version, download, verify, and hand off to apply-update.sh. */
  async check() {
    const latest = await this._get('/api/v1/agent/updates/latest');
    if (!latest || !latest.eligible || latest.version === this.currentVersion) return;

    console.log(`[updater] new agent version available: ${latest.version}`);
    const res = await fetch(this.serverUrl + `/api/v1/agent/updates/${latest.version}/package`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    if (!res.ok) throw new Error(`package download -> HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const publicKeyPem = fs.readFileSync(this.publicKeyPath, 'utf8');
    verifyPackage(buf, { sha256: latest.sha256, signature: latest.signature, publicKeyPem });

    fs.mkdirSync(this.updatesDir, { recursive: true });
    const debPath = path.join(this.updatesDir, `monitor-agent_${latest.version}.deb`);
    fs.writeFileSync(debPath, buf);

    await this._report({ version: latest.version, status: 'applying' });

    // Detached: apply-update.sh restarts monitor-agent.service, which kills
    // this process — the child must survive that, not depend on it.
    const child = cp.spawn('sudo', [APPLY_SCRIPT, debPath], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  start() {
    if (!this.scfg.enabled) return () => {};
    const interval = (this.scfg.check_interval || 3600) * 1000;
    console.log(`[updater] self-update enabled — checking every ${interval / 1000}s`);
    const timer = setInterval(() => {
      this.check().catch((e) => console.warn(`[updater] ${e.message}`));
    }, interval);
    this.check().catch((e) => console.warn(`[updater] ${e.message}`));
    return () => clearInterval(timer);
  }
}

module.exports = { Updater };
