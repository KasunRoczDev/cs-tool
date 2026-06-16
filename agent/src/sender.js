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
