# Cybersecurity & Server Metrics Monitoring Platform

Centralized monitoring of server performance and security events. A lightweight
Ubuntu agent collects telemetry and streams it over HTTPS to a central backend,
which stores it in TimescaleDB, runs an alert engine, and serves a real-time
Next.js dashboard over WebSockets.

```
[ Ubuntu servers ]                [ Central platform ]
   monitor-agent  ──HTTPS POST──▶  NestJS backend ──┬─▶ TimescaleDB (metrics, events)
   (CPU/mem/disk/net               (REST + WS)      ├─▶ Alert engine
    + SSH/sudo/UFW)                                 └─▶ Socket.IO ─▶ Next.js dashboard
```

## Components

| Dir | Stack | What it is |
|-----|-------|------------|
| `agent/` | Node.js | Ubuntu monitoring agent (metrics + security logs, offline buffering, retry) |
| `packaging/` | dpkg + systemd | Builds the installable `.deb` and the systemd service |
| `backend/` | NestJS + pg | REST ingestion + dashboard APIs, JWT auth, alert engine, Socket.IO gateway |
| `database/` | PostgreSQL + TimescaleDB | Hypertables, continuous aggregates, retention/compression |
| `dashboard/` | Next.js + Recharts | Live dashboard: overview, per-server charts, security timeline, alerts, compare |

## Quick start (Docker)

```bash
cp backend/.env.example backend/.env      # optional, compose sets sane defaults
docker compose up --build
```

- Dashboard: http://localhost:5173  (login `admin@example.com` / `admin123`)
- API:       http://localhost:4000/api/v1
- DB:        localhost:5432 (monitor/monitor)

The backend container applies `database/schema.sql` and seeds the admin user on
start (`scripts/migrate.js`).

## Onboard a server & run the agent

1. In the dashboard click **+ Add server** and copy the one-time API key.
2. On the Ubuntu server, build & install the package (see `packaging/README.md`):
   ```bash
   cd packaging && ./build-deb.sh
   sudo dpkg -i ../dist/monitor-agent_1.0.0_all.deb
   ```
3. Edit `/etc/monitor-agent/agent.yaml` — set `server_url` and `api_key`.
4. `sudo systemctl enable --now monitor-agent` then `journalctl -u monitor-agent -f`.

For a quick local test without packaging:
```bash
cd agent && npm install
MONITOR_SERVER_URL=http://localhost:4000 MONITOR_API_KEY=agt_xxx \
MONITOR_CONFIG=./config/agent.example.yaml npm start
```

## Local development (no Docker)

```bash
# DB
docker run -d --name tsdb -p 5432:5432 \
  -e POSTGRES_USER=monitor -e POSTGRES_PASSWORD=monitor -e POSTGRES_DB=monitoring \
  timescale/timescaledb:2.17.2-pg16

# Backend
cd backend && npm install && cp .env.example .env
npm run migrate && npm run start:dev      # :4000

# Dashboard
cd dashboard && npm install && npm run dev # :5173 (proxies /api + /socket.io to :4000)
```

## API summary

Agent → backend (header `X-Api-Key`):
- `POST /api/v1/metrics` — `{ metrics: [{ cpu, memory, disk, net_in, net_out, timestamp }] }`
- `POST /api/v1/security-events` — `{ events: [{ event_type, severity, message, source_ip }] }`

Dashboard → backend (header `Authorization: Bearer <jwt>`):
- `POST /api/v1/auth/login`
- `GET  /api/v1/servers` · `GET /api/v1/servers/overview`
- `POST /api/v1/servers` (onboard, returns one-time key)
- `GET  /api/v1/servers/:id/metrics?from&to`
- `GET  /api/v1/servers/:id/security-events?type`
- `GET  /api/v1/alerts?status` · `POST /api/v1/alerts/:id/resolve`

WebSocket events: `metric`, `security_event`, `alert`, `server_status`.

## Alerting

The engine evaluates each ingested sample and raises/auto-resolves alerts for:
CPU / memory / disk thresholds, SSH brute-force (failed-login burst), and server
offline (periodic check). Thresholds are configured via backend env vars
(`ALERT_*`). Open alerts are de-duplicated per server+type and broadcast live.

## Security notes

- TLS for all agent traffic (set `tls_verify: true`); API key per server, stored hashed (sha256).
- Passwords are never collected from logs.
- Dashboard auth is JWT with role-based access (admin / operator / viewer).
- Agent runs as an unprivileged systemd user with CPU/memory caps and filesystem hardening.

> Change `JWT_SECRET`, the DB credentials, and the seeded admin password before any real deployment.
