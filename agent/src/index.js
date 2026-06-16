#!/usr/bin/env node
'use strict';
// Monitor Agent entrypoint. Runs as a systemd service.
const { loadConfig } = require('./config');
const { collectMetric } = require('./collectors/metrics');
const { startSecurity } = require('./collectors/security');
const { Sender } = require('./sender');

const CONFIG_PATH =
  process.env.MONITOR_CONFIG || '/etc/monitor-agent/agent.yaml';

function main() {
  const cfg = loadConfig(CONFIG_PATH);
  console.log(`[agent] starting -> ${cfg.server_url}`);
  const sender = new Sender(cfg);

  let metricsTimer;
  let sendTimer;
  let stopSecurity = () => {};

  if (cfg.metrics) {
    // Prime CPU/network counters, then collect on interval.
    collectMetric();
    metricsTimer = setInterval(() => {
      try {
        sender.enqueueMetric(collectMetric());
      } catch (e) {
        console.warn(`[agent] metric collection error: ${e.message}`);
      }
    }, cfg.metrics_interval * 1000);
  }

  if (cfg.security_logs) {
    stopSecurity = startSecurity(cfg, (event) => sender.enqueueEvent(event));
  }

  sendTimer = setInterval(() => {
    sender.flush().catch((e) => console.warn(`[agent] flush error: ${e.message}`));
  }, cfg.send_interval * 1000);

  const shutdown = async (sig) => {
    console.log(`[agent] ${sig} received, flushing...`);
    clearInterval(metricsTimer);
    clearInterval(sendTimer);
    stopSecurity();
    await sender.flush().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
