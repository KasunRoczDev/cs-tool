'use strict';
// Deploy runner: polls the platform for release jobs assigned to this server,
// runs the fixed pipeline via scripts/deploy-release.sh, parses step markers,
// and reports running/final status (with logs) back to the platform.
//
// Enable in agent.yaml:
//   deploy:
//     enabled: true
//     poll_interval: 15          # seconds
//     base_dir: /var/www/release-env
//     script: /opt/monitor-agent/scripts/deploy-release.sh
//     healthcheck_url: ""        # optional, passed to the script per run

const { spawn } = require('child_process');
const path = require('path');

class DeployRunner {
  constructor(cfg) {
    this.cfg = cfg;
    this.dcfg = cfg.deploy || {};
    this.serverUrl = cfg.server_url.replace(/\/$/, '');
    this.apiKey = cfg.api_key;
    this.script =
      this.dcfg.script || path.resolve(__dirname, '..', 'scripts', 'deploy-release.sh');
    this.running = false;
  }

  async _api(pathName, body) {
    const res = await fetch(this.serverUrl + pathName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(`${pathName} -> HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  /** One poll cycle: claim jobs and run them sequentially. */
  async tick() {
    if (this.running) return; // never overlap deploys on one host
    let jobs = [];
    try {
      jobs = await this._api('/api/v1/agent/deploy-jobs/claim', {});
    } catch (e) {
      console.warn(`[deploy] claim failed: ${e.message}`);
      return;
    }
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    this.running = true;
    try {
      for (const job of jobs) {
        await this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  async runJob(job) {
    console.log(`[deploy] running job ${job.id} (${job.env_path}/${job.repo_slug})`);
    await this._report(job.id, { status: 'running' }).catch(() => {});

    const args = [
      this.script,
      '--env', job.env_path,
      '--repo', job.repo_slug,
      '--base-dir', this.dcfg.base_dir || '/var/www/release-env',
    ];
    if (job.branch) args.push('--branch', job.branch);
    if (job.commit_sha) args.push('--commit', job.commit_sha);
    const cmds = Array.isArray(job.custom_commands) ? job.custom_commands : [];
    for (const c of cmds) args.push('--cmd', String(c));
    // "KEY=VALUE" strings resolved server-side (channel/product env vars +
    // decrypted secrets) — written to a .env file by the script, never logged.
    const envVars = Array.isArray(job.env_vars) ? job.env_vars : [];
    for (const kv of envVars) args.push('--env-var', String(kv));

    const env = { ...process.env };
    if (this.dcfg.healthcheck_url) env.HEALTHCHECK_URL = this.dcfg.healthcheck_url;

    const { code, output } = await this._spawn('bash', args, env);
    const steps = this._parseSteps(output);
    const status = code === 0 ? 'succeeded' : 'failed';
    const error = code === 0 ? undefined : (steps.find((s) => s.status === 'fail')?.name
      ? `failed at step "${steps.find((s) => s.status === 'fail').name}"`
      : `exit code ${code}`);

    await this._report(job.id, {
      status,
      steps,
      log: output.slice(-60000), // cap payload
      error,
    }).catch((e) => console.warn(`[deploy] report failed: ${e.message}`));
    console.log(`[deploy] job ${job.id} ${status}`);
  }

  _spawn(cmd, args, env) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { env });
      let output = '';
      const onData = (d) => { output += d.toString(); };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => resolve({ code: 1, output: output + `\nspawn error: ${e.message}` }));
      child.on('close', (code) => resolve({ code: code ?? 1, output }));
    });
  }

  /** Turn ::step:<name>:<start|ok|fail>:: markers into [{name,status}]. */
  _parseSteps(output) {
    const order = [];
    const map = new Map();
    const re = /::step:([a-z-]+):(start|ok|fail)::/g;
    let m;
    while ((m = re.exec(output))) {
      const [, name, state] = m;
      if (!map.has(name)) { order.push(name); map.set(name, 'running'); }
      if (state === 'ok') map.set(name, 'succeeded');
      else if (state === 'fail') map.set(name, 'fail');
    }
    return order.map((name) => ({ name, status: map.get(name) }));
  }

  _report(jobId, body) {
    return this._api(`/api/v1/agent/deploy-jobs/${jobId}/result`, body);
  }

  start() {
    if (!this.dcfg.enabled) return () => {};
    const interval = (this.dcfg.poll_interval || 15) * 1000;
    console.log(`[deploy] runner enabled — polling every ${interval / 1000}s`);
    const timer = setInterval(() => this.tick().catch(() => {}), interval);
    this.tick().catch(() => {});
    return () => clearInterval(timer);
  }
}

module.exports = { DeployRunner };
