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

The agent ranks the slowest endpoints from the nginx access log, **per site**. This
box fronts many vhosts, so `host=$host` attributes each request to the correct site,
and `rt=$request_time` gives the timing. The dashboard shows the real nginx request
URL per site (path-routed apps show their true routes automatically); only legacy
front-controller sites need per-host rename rules in `dashboard/lib/routeMap.js`.
Apply this `log_format` to the shared access log (or every vhost's log):

```nginx
log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                 '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                 'host=$host rt=$request_time urt=$upstream_response_time';
access_log /var/log/nginx/access.log timed;
```

**Front-controller routes (`/index.php?...`):** for an app that dispatches on
request params there is no route name beyond those params — the query string *is*
the route. GET routes are already distinguished by their query. The one blind spot
is `POST /index.php`, whose action lives in the request body. Without changing the
PHP app, nginx can log the body so POST actions split apart:

```nginx
log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                 '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                 'host=$host rt=$request_time urt=$upstream_response_time body="$request_body"';
```

⚠ `$request_body` can contain credentials/PII — only enable on internal/staging,
or restrict to specific locations, and never ship these logs off-box unfiltered.
Note this only enriches the *Slowest endpoints* (latency) table; the CPU table is
sourced from PHP-FPM status, which never sees the body, so POSTs cannot be split there.

`rt` is end-to-end time, `urt` the PHP-FPM portion. The agent emits a
`nginx_slow_request` event for any request slower than `MONITOR_NGINX_SLOW_SECONDS`
(default `1.0`). The dashboard's PHP-FPM page aggregates these into a "Slowest
endpoints" table (count / avg / p95 / max), masking volatile ids so the same logical
route groups together. Reload nginx after changing the log_format: `nginx -t && systemctl reload nginx`.

### Lynis host-hardening audit

`lynis audit system` writes `/var/log/lynis-report.dat`. The agent's Lynis collector
parses it and emits security events — no schema change, visible on the dashboard's
**Security** page (filter event type `lynis_*`) and as a hardening-score card:

- `lynis_audit` (info) — one per run; `hardening_index` (0–100) + counts in `raw`.
- `lynis_warning` (medium) — one per `warning[]`.
- `lynis_suggestion` (low) — one per `suggestion[]`.

Enable it: `apt install lynis`, then in `agent.yaml` set the `lynis:` block
(`enabled: true`, `run: true` to let the agent audit on a schedule, or `run: false`
to only parse a report you generate via cron). Standalone agent equivalents:
`MONITOR_LYNIS=true MONITOR_LYNIS_RUN=true MONITOR_LYNIS_INTERVAL_HOURS=24`.
Lynis needs root to audit fully, so the agent must run privileged for `run: true`.
Check the raw data on the host any time with:
`grep -E 'hardening_index|^warning\[\]|^suggestion\[\]' /var/log/lynis-report.dat`.

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
