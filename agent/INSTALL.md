# Monitor Agent — Full Installation Guide

End-to-end guide for installing the **monitor-agent** on an Ubuntu/Debian server and streaming system + security telemetry to the central monitoring platform.

- **Package:** `monitor-agent` v1.1.0
- **Runtime:** Node.js ≥ 18
- **Service:** systemd (`monitor-agent.service`), auto-restart, capped at 15% CPU / 128 MB RAM
- **Default config:** `/etc/monitor-agent/agent.yaml`

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| Ubuntu 20.04+ / Debian 11+ | Other systemd Linux works too |
| `nodejs` ≥ 18 | Hard dependency of the `.deb` |
| Root / `sudo` | Needed for install and service control |
| Network egress to the platform | HTTPS (443) to your `server_url` |
| A per-server **API key** | Issued by the platform — see §2 |

Install Node.js 18 if missing:

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # expect v18.x or newer
```

Optional, only if you enable the matching collectors (see §6):

```bash
sudo apt install lynis libfcgi-bin     # host-hardening audit / PHP-FPM socket probe
# postgres-client, redis-tools, openssl, docker — for service-metrics probes
```

---

## 2. Get a server API key

Each agent authenticates with a **per-server** key issued by the platform during onboarding (`POST /api/v1/servers`). Create the server record in the dashboard (or via the API) and copy the `agt_...` key it returns. You'll paste it into the config in §5.

Keep this key secret — it is the agent's only credential.

---

## 3. Build the `.deb` package

Run on any Ubuntu/Debian machine with `dpkg-deb` and `bash` (a CI box or your workstation — not necessarily the target server).

```bash
cd packaging
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm
./build-deb.sh
# -> dist/monitor-agent_1.1.0_all.deb
```

The build stages the agent into the standard layout and produces `dist/monitor-agent_1.1.0_all.deb`. Copy that file to each target server (e.g. `scp dist/monitor-agent_1.1.0_all.deb user@server:/tmp/`).

---

## 4. Install on a target server

```bash
sudo dpkg -i monitor-agent_1.1.0_all.deb

# If nodejs (or other deps) is missing, let apt resolve them:
sudo apt-get -f install
```

The package's `postinst` automatically:

- creates the dedicated `monitor-agent` system user (no home, no login shell),
- creates the offline buffer dir `/var/lib/monitor-agent/` (perms `750`),
- locks down `/etc/monitor-agent/` (`750`) and `agent.yaml` (`640`),
- installs the `js-yaml` dependency into `/usr/lib/monitor-agent/`,
- runs `systemctl daemon-reload` and **enables** (but does not start) the service.

### Installed layout

| Path | Purpose |
|------|---------|
| `/usr/lib/monitor-agent/` | agent source + `package.json` |
| `/etc/monitor-agent/agent.yaml` | configuration (conffile — preserved on upgrade) |
| `/lib/systemd/system/monitor-agent.service` | systemd unit |
| `/var/lib/monitor-agent/` | offline buffer (`buffer.ndjson`) |

---

## 5. Minimum configuration

Edit the config and set the two required fields:

```bash
sudo nano /etc/monitor-agent/agent.yaml
```

```yaml
server_url: https://monitor.example.com   # your platform base URL (HTTPS in prod)
api_key: agt_xxxxxxxxxxxxxxxxxxxx          # the key from §2
```

`api_key` is mandatory — the agent refuses to start without it (it can alternatively be supplied via the `MONITOR_API_KEY` environment variable). Keep `tls_verify: true` in production; only set it to `false` for self-signed lab certs.

Then start the service (§7).

---

## 6. Full configuration reference

All keys live in `/etc/monitor-agent/agent.yaml`. Defaults shown; every optional collector is **off** until enabled.

### Core

| Key | Default | Meaning |
|-----|---------|---------|
| `server_url` | `http://localhost:4000` | Platform base URL |
| `api_key` | *(required)* | Per-server key |
| `metrics_interval` | `15` | Metric sample interval (s) |
| `send_interval` | `30` | Flush buffered data to server (s) |
| `metrics` | `true` | Toggle CPU/mem/disk/net/load collection |
| `security_logs` | `true` | Toggle SSH/sudo/firewall event collection |
| `tls_verify` | `true` | Verify server TLS cert |
| `buffer_file` | `/var/lib/monitor-agent/buffer.ndjson` | Offline buffer (NDJSON) |
| `buffer_max_items` | `50000` | Max buffered records |
| `auth_log` | `/var/log/auth.log` | Security log source |
| `use_journald` | `true` | Prefer `journalctl` when available |

**Collected by default:** CPU %, memory %, disk %, network in/out, 1-min load; plus SSH logins, failed SSH logins, sudo usage, and UFW firewall blocks. Passwords are never captured.

### PHP-FPM (`fpm`) — optional

Reports pool saturation and the busiest worker. Requires `pm.status_path = /fpm-status` in each pool config.

```yaml
fpm:
  enabled: true
  pools:
    - name: www
      status_url: http://127.0.0.1/fpm-status   # nginx-exposed, restrict to localhost
    # - name: api
    #   socket: /run/php/php8.3-fpm.sock          # direct socket (needs libfcgi-bin)
    #   status_path: /fpm-status
```

### Lynis host-hardening audit (`lynis`) — optional

Emits the hardening index + warnings/suggestions to the Security page. Requires `apt install lynis`.

```yaml
lynis:
  enabled: true
  run: true                # agent runs `lynis audit system` itself
  interval_hours: 24
  run_timeout_sec: 900
  initial_delay_sec: 120
  report_path: /var/log/lynis-report.dat
  max_warnings: 100
  max_suggestions: 60
```

### Service / application metrics (`service_metrics`) — optional

Powers the "Service Metrics" dashboard page. Every probe is optional — omit a section and that metric stays blank.

```yaml
service_metrics:
  enabled: true
  api:
    metrics_url: http://127.0.0.1:4000/internal/metrics   # JSON { p95_ms, error_rate }
    # access_log: /var/log/nginx/access.log               # or parse $request_time
    # window_lines: 2000
  postgres:
    url: postgres://monitor:monitor@127.0.0.1:5432/monitoring   # needs psql
    slow_ms: 1000
  redis:
    url: redis://127.0.0.1:6379                           # needs redis-cli
    maxmemory_mb: 1024
  bullmq:
    prefix: bull
    queues: [orders, notifications]
  docker:
    enabled: true                                         # needs docker
  tls_targets:
    - monitor.example.com:443                             # needs openssl
  ssh_window_sec: 300
  orders:
    metrics_url: http://127.0.0.1:4000/internal/orders-health   # JSON { success, total }
  # thresholds:
  #   api_p95_ms:       { warn: 1000, crit: 3000 }
  #   ssl_expiry_days:  { warn: 14,   crit: 7, invert: true }
```

After any config change, restart: `sudo systemctl restart monitor-agent`.

---

## 7. Start and enable the service

```bash
sudo systemctl enable --now monitor-agent   # enable at boot + start now
sudo systemctl status monitor-agent         # check it's active (running)
```

The unit auto-restarts on failure (`Restart=always`, 5s delay) and is hardened (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`) with read access to auth logs/journal via the `adm` and `systemd-journal` groups.

---

## 8. Verify it's working

```bash
# Live logs — look for "[agent] starting -> https://monitor.example.com"
journalctl -u monitor-agent -f

# Service health
systemctl is-active monitor-agent

# Offline buffer should stay small/empty when the server is reachable
ls -la /var/lib/monitor-agent/
```

Then confirm the server appears as **online** with incoming metrics on the platform dashboard. Data should arrive within `send_interval` (default 30s).

---

## 9. Run without packaging (dev / test)

For a quick local run straight from the repo:

```bash
cd agent
npm install
MONITOR_CONFIG=./config/agent.example.yaml \
MONITOR_SERVER_URL=http://localhost:4000 \
MONITOR_API_KEY=agt_xxx \
npm start
```

Run the test suite:

```bash
npm test
```

---

## 10. Upgrade

Build the new `.deb` (§3), copy it over, and reinstall:

```bash
sudo dpkg -i monitor-agent_<new-version>_all.deb
sudo systemctl restart monitor-agent
```

`agent.yaml` is a conffile, so your settings are preserved across upgrades (dpkg will prompt if the packaged default changed).

---

## 11. Uninstall

```bash
# Remove the package, keep config + buffered data
sudo apt remove monitor-agent

# Remove everything, including config, buffer, and the monitor-agent user
sudo apt purge monitor-agent
```

`prerm` stops and disables the service; `postrm` on **purge** deletes `/var/lib/monitor-agent` and the system user.

---

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Service won't start; log says `api_key is required` | `api_key` unset in `agent.yaml` (or `MONITOR_API_KEY`). Set it, then `sudo systemctl restart monitor-agent`. |
| `dpkg` error about missing `nodejs` | Run `sudo apt-get -f install`, or install Node 18 first (§1). |
| Server shows offline, buffer file growing | Agent can't reach `server_url`. Check egress/DNS/firewall and `tls_verify`. Buffered data flushes automatically once connectivity returns. |
| TLS handshake errors | Self-signed cert — set `tls_verify: false` for lab only, or install a trusted cert. |
| No security events | Confirm `security_logs: true` and that the unit can read logs (it joins `adm`/`systemd-journal`). Check `auth_log` path / `use_journald`. |
| FPM/Lynis/service metrics blank | Collector not `enabled`, or its dependency missing (`lynis`, `libfcgi-bin`, `psql`, `redis-cli`, `openssl`, `docker`). |
| Edits to config ignored | Restart after changes: `sudo systemctl restart monitor-agent`. |
| Inspect resource limits | `systemctl show monitor-agent -p CPUQuota -p MemoryMax` (15% / 128M). |

Handy commands:

```bash
journalctl -u monitor-agent -f          # follow logs
journalctl -u monitor-agent --since "10 min ago"
sudo systemctl restart monitor-agent
sudo systemctl status monitor-agent
```
