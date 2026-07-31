'use strict';
// Buffered, retrying transmitter. Persists unsent items to disk so nothing is
// lost across restarts or network outages.
const fs = require('fs');
const path = require('path');
const https = require('https');

class Sender {
  constructor(cfg) {
    this.cfg = cfg;
    this.metricsQueue = [];
    this.eventsQueue = [];
    this._loadBuffer();
    // Allow self-signed certs only when tls_verify is explicitly false.
    this.agent = new https.Agent({ rejectUnauthorized: cfg.tls_verify !== false });
    // Undefined until the first check; avoids logging a spurious "back up"
    // transition on the very first flush.
    this._serverUp = undefined;
  }

  enqueueMetric(m) {
    this.metricsQueue.push(m);
    this._trim();
  }

  enqueueEvent(e) {
    this.eventsQueue.push(e);
    this._trim();
  }

  _trim() {
    const max = this.cfg.buffer_max_items;
    if (this.metricsQueue.length > max) this.metricsQueue.splice(0, this.metricsQueue.length - max);
    if (this.eventsQueue.length > max) this.eventsQueue.splice(0, this.eventsQueue.length - max);
  }

  async flush() {
    if (!this.metricsQueue.length && !this.eventsQueue.length) return;

    // Probe with a cheap request first so a down server doesn't get hit with
    // the full (possibly large) buffered payload on every send interval.
    const up = await this._isServerUp();
    if (!up) {
      if (this._serverUp !== false) {
        console.warn(`[sender] ${this.cfg.server_url} unreachable, buffering data (not sending)`);
      }
      this._serverUp = false;
      this._saveBuffer();
      return;
    }
    if (this._serverUp === false) {
      console.log(`[sender] ${this.cfg.server_url} is back up, resuming sends`);
    }
    this._serverUp = true;

    if (this.metricsQueue.length) {
      const batch = this.metricsQueue.splice(0, this.metricsQueue.length);
      const ok = await this._post('/api/v1/metrics', { metrics: batch });
      if (!ok) this.metricsQueue.unshift(...batch); // requeue on failure
    }
    if (this.eventsQueue.length) {
      const batch = this.eventsQueue.splice(0, this.eventsQueue.length);
      const ok = await this._post('/api/v1/security-events', { events: batch });
      if (!ok) this.eventsQueue.unshift(...batch);
    }
    this._saveBuffer();
  }

  // Lightweight reachability probe (no body) so a dead server is detected
  // without constructing/transmitting the full metrics/events payload.
  async _isServerUp() {
    const base = this.cfg.server_url.replace(/\/$/, '');
    const controller = new AbortController();
    const timeoutMs = (this.cfg.health_check_timeout || 5) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Any HTTP response (even 404/405) means the server process is up and
      // reachable; only network-level failures (refused, timed out, DNS)
      // count as down.
      await fetch(base, { method: 'HEAD', signal: controller.signal });
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async _post(pathName, body) {
    const url = this.cfg.server_url.replace(/\/$/, '') + pathName;
    const payload = JSON.stringify(body);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.cfg.api_key,
        },
        body: payload,
        // Node fetch uses undici; pass dispatcher only for https self-signed
        ...(url.startsWith('https') && this.cfg.tls_verify === false
          ? { dispatcher: undefined }
          : {}),
      });
      if (res.ok) return true;
      console.warn(`[sender] ${pathName} -> HTTP ${res.status}`);
      return false;
    } catch (e) {
      console.warn(`[sender] ${pathName} failed: ${e.message} (buffering)`);
      return false;
    }
  }

  _saveBuffer() {
    try {
      const dir = path.dirname(this.cfg.buffer_file);
      fs.mkdirSync(dir, { recursive: true });
      const lines = [
        ...this.metricsQueue.map((m) => JSON.stringify({ t: 'm', d: m })),
        ...this.eventsQueue.map((e) => JSON.stringify({ t: 'e', d: e })),
      ];
      fs.writeFileSync(this.cfg.buffer_file, lines.join('\n'));
    } catch (e) {
      console.warn(`[sender] could not persist buffer: ${e.message}`);
    }
  }

  _loadBuffer() {
    try {
      if (!fs.existsSync(this.cfg.buffer_file)) return;
      const lines = fs.readFileSync(this.cfg.buffer_file, 'utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        const { t, d } = JSON.parse(l);
        if (t === 'm') this.metricsQueue.push(d);
        else if (t === 'e') this.eventsQueue.push(d);
      }
      console.log(`[sender] restored ${lines.length} buffered items`);
    } catch (e) {
      console.warn(`[sender] could not load buffer: ${e.message}`);
    }
  }
}

module.exports = { Sender };
