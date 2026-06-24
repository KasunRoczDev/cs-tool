# `monitoring/` — gap-closing add-ons

These files extend the existing platform to cover the monitoring blind spots in a
typical DevOps/DevSec setup. Everything here is **additive** — no existing agent,
backend, or dashboard code is modified.

## What was missing and what fills it

| Layer | Gap | Added here |
|-------|-----|-----------|
| Server | swap, inodes, disk I/O, conntrack, file descriptors, TCP states, zombies, load 5/15, NTP drift | `agent/src/collectors/metrics-extended.js` |
| Security | TLS cert expiry, dependency/OS CVEs | `agent/src/collectors/cert-cve.js` |
| Security | runtime intrusion detection | `security-tools/falco/` |
| Security | active brute-force blocking | `security-tools/fail2ban/` |
| Security | OS-level audit events | `security-tools/auditd/` |
| Security | container/image + secret scanning | `security-tools/scan/`, `security-tools/ci/gitleaks.toml` |
| App | distributed tracing | `app-instrumentation/otel-tracing.js` |
| App | queue/cache/DB health | `app-instrumentation/queue-db-health.js` |
| App | SLOs + alert thresholds | `app-instrumentation/slo.yaml` |
| Optional | Prometheus/Grafana/Tempo sidecar | `app-instrumentation/docker-compose.observability.yml` |

## Wiring the new collectors into the agent

In `agent/src/index.js`, merge the extended metrics into each sample and start the
cert/CVE checker (it emits via your existing `onEvent` → `/api/v1/security-events`):

```js
const { collectMetric } = require('./collectors/metrics');
const { collectExtendedMetric } = require('./collectors/metrics-extended');
const { startCertCve } = require('./collectors/cert-cve');

const metric = { ...collectMetric(), ...collectExtendedMetric() };

const stopCert = startCertCve({
  tls_targets: ['api.example.com:443', 'dashboard.example.com:443'],
  cert_paths:  ['/etc/letsencrypt/live/example.com/cert.pem'],
  audit_dirs:  ['/opt/app'],
}, onEvent);
```

### PHP-FPM pool monitoring

Enable `pm.status_path = /fpm-status` in each pool conf, expose it to localhost via
nginx, then set the `fpm:` block in `agent.yaml` (see `agent/config/agent.example.yaml`).
In `index.js`, on each tick:

```js
const { collectFpm } = require('./collectors/fpm');
const { metrics, events } = await collectFpm(cfg);
metrics.forEach((m) => sender.enqueueMetric(m));   // pool rows + top-CPU/top-mem worker
events.forEach((e) => sender.enqueueEvent(e));      // saturation / hot-worker alerts
```

Each pool metric carries `fpm_utilisation`, `fpm_listen_queue`, `fpm_max_children_reached`,
and — the part you asked for — `fpm_top_cpu` and `fpm_top_memory`, each an object with
the worker's `cpu`, `memory_mb`, `method`, `request_uri`, and `duration_ms` (the exact
request that worker was serving). Events: `fpm_max_children_reached`, `fpm_pool_saturated`,
`fpm_listen_queue_backlog`, `fpm_slow_requests`, `fpm_hot_worker`, `fpm_unreachable`.

Note: for a front-controller app the FPM status `request_uri` is always `/index.php?...`
(the route lives in the query string) and only samples one worker per poll — it cannot
show *where inside* a request the time goes. Use the slow-endpoint view below for that.

### Slow-request endpoints (bottleneck view)

The agent ranks the slowest endpoints from the nginx access log. This requires the
nginx `log_format` to append the request time, then point the access log at the agent:

```nginx
log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                 '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                 'rt=$request_time urt=$upstream_response_time';
access_log /var/log/nginx/access.log timed;
```

`rt` is end-to-end time, `urt` the PHP-FPM portion. The agent emits a
`nginx_slow_request` event for any request slower than `MONITOR_NGINX_SLOW_SECONDS`
(default `1.0`). The dashboard's PHP-FPM page aggregates these into a "Slowest
endpoints" table (count / avg / p95 / max), masking volatile ids so the same logical
route groups together. Reload nginx after changing the log_format: `nginx -t && systemctl reload nginx`.

To persist the new metric fields, add the columns to `database/schema.sql`
(`swap`, `inode`, `disk_read_bps`, `disk_write_bps`, `disk_io_queue`,
`conntrack`, `fd_usage`, `tcp_established`, `tcp_time_wait`, `tcp_syn_recv`,
`proc_zombie`, `load_avg_5`, `load_avg_15`, `time_drift_ms`, `uptime`) and widen
the ingest DTO. New `event_type`s (`tls_cert_expiry`, `dependency_vulnerability`,
`os_security_updates_pending`, `ssh_root_login_enabled`, …) need no schema change —
your `security_events` table already takes arbitrary types.

## Host setup (per monitored server)

```bash
apt install -y fail2ban auditd lynis
cp security-tools/fail2ban/jail.local /etc/fail2ban/jail.local && systemctl restart fail2ban
cp security-tools/auditd/monitor.rules /etc/audit/rules.d/ && augenrules --load
# Falco + Trivy: see headers in their respective files.
lynis audit system          # one-off CIS-style hardening audit
```

See `MONITORING_SECURITY_REFERENCE.docx` (repo root) for the full metric /
threshold / alert checklist.
