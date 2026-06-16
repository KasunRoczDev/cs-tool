# Server Setup Guide — Cybersecurity & Server Metrics Monitoring Platform

Step-by-step setup for the central platform (database, backend API, dashboard)
and for the Ubuntu monitoring agent on each server you want to watch.

- **Part A** — Central platform with Docker (fastest)
- **Part B** — Central platform without Docker (manual)
- **Part C** — Install the agent on an Ubuntu server
- **Part D** — RBAC: roles & user management
- **Part E** — Troubleshooting

---

## Architecture

```
[ Ubuntu servers ]                 [ Central platform ]
   monitor-agent  ──HTTPS POST──▶   NestJS backend ──┬─▶ TimescaleDB (metrics, events)
   CPU/mem/disk/net                 (REST + WS)       ├─▶ Alert engine
   + SSH/sudo/UFW                                     └─▶ Socket.IO ─▶ Next.js dashboard
```

Default ports: **5432** database · **4000** backend API · **5173** dashboard.

---

## Part A — Central platform with Docker

Prerequisites: Docker + Docker Compose on the host.

1. Get the project onto the host and enter it:
   ```bash
   cd "Cybersecurity & Server Metrics Monitoring Platform"
   ```
2. (Optional) Review/adjust settings in `docker-compose.yml` — at minimum change
   `JWT_SECRET` and the database password before production.
3. Build and start everything:
   ```bash
   docker compose up --build -d
   ```
   This starts three services: `db` (TimescaleDB), `backend` (applies the schema +
   seeds the admin user, then serves the API), and `dashboard` (Next.js).
4. Check status and logs:
   ```bash
   docker compose ps
   docker compose logs -f backend
   ```
5. Open the dashboard at **http://localhost:5173** and log in with:
   - Email: `admin@example.com`
   - Password: `admin123`  ← change this immediately (Part D).

> The dashboard proxies `/api` to the backend. The proxy target is baked at build
> time from the `BACKEND_URL` build arg (`http://backend:4000`), already set in
> `docker-compose.yml`. If you change it, rebuild the dashboard image.

To rebuild after code changes:
```bash
docker compose build --no-cache dashboard backend
docker compose up -d
```

---

## Part B — Central platform without Docker (manual)

Prerequisites: Node.js 18+ and PostgreSQL 14+ with the TimescaleDB extension.

### B1. Database
```bash
# Example: run TimescaleDB in a container, or use a managed/installed instance.
docker run -d --name tsdb -p 5432:5432 \
  -e POSTGRES_USER=monitor -e POSTGRES_PASSWORD=monitor -e POSTGRES_DB=monitoring \
  timescale/timescaledb:2.17.2-pg16
```

### B2. Backend
```bash
cd backend
cp .env.example .env          # edit DATABASE_URL, JWT_SECRET, ALERT_* as needed
npm install
npm run migrate               # applies database/schema.sql + seeds admin
npm run build
npm run start:prod            # serves on :4000  (or: npm run start:dev)
```
Set a custom admin during migrate:
```bash
ADMIN_EMAIL=you@co.com ADMIN_PASSWORD='strong-pass' npm run migrate
```

### B3. Dashboard
```bash
cd dashboard
cp .env.example .env
npm install
# Dev (proxies /api + /socket.io to BACKEND_URL):
BACKEND_URL=http://localhost:4000 npm run dev      # :5173
# Production:
BACKEND_URL=http://localhost:4000 npm run build
npm run start                                       # :5173
```

---

## Part C — Install the agent on an Ubuntu server

Each monitored server runs a small Node.js agent. Two options — a single self-contained
file (recommended, no dependencies) or the `.deb` package.

### C0. Onboard the server (get an API key)
In the dashboard: **+ Add server** → enter a name → **copy the one-time API key**.
You will paste this into the agent config.

### C1. Option 1 — single-file agent (recommended)

1. Install Node 18+ **system-wide** (must be on the system PATH, not nvm-only):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   /usr/bin/node -v
   ```
2. Create the service user and directories:
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin monitor-agent
   sudo mkdir -p /opt/monitor-agent /var/lib/monitor-agent
   sudo chown -R monitor-agent:monitor-agent /var/lib/monitor-agent
   ```
3. Copy `agent/standalone/monitor-agent.js` to the server at
   `/opt/monitor-agent/monitor-agent.js` (via `scp`, or paste with
   `sudo nano /opt/monitor-agent/monitor-agent.js`).
4. Create the systemd service (replace the two values):
   ```bash
   sudo tee /etc/systemd/system/monitor-agent.service > /dev/null <<'UNIT'
   [Unit]
   Description=Monitor Agent - system & security telemetry collector
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=monitor-agent
   Group=monitor-agent
   ExecStart=/usr/bin/node /opt/monitor-agent/monitor-agent.js
   Environment=MONITOR_SERVER_URL=http://YOUR_BACKEND_HOST:4000
   Environment=MONITOR_API_KEY=PASTE_YOUR_API_KEY
   Restart=always
   RestartSec=5
   CPUQuota=15%
   MemoryMax=128M
   NoNewPrivileges=true
   ReadWritePaths=/var/lib/monitor-agent
   SupplementaryGroups=adm systemd-journal

   [Install]
   WantedBy=multi-user.target
   UNIT
   ```
5. Start and verify:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now monitor-agent
   sudo systemctl status monitor-agent --no-pager
   journalctl -u monitor-agent -f
   ```
The server flips to **online** in the dashboard within a few seconds.

#### Agent environment variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `MONITOR_SERVER_URL` | — (required) | Backend base URL reachable from this server |
| `MONITOR_API_KEY` | — (required) | Per-server key from onboarding |
| `MONITOR_METRICS_INTERVAL` | 15 | Seconds between metric samples |
| `MONITOR_SEND_INTERVAL` | 30 | Seconds between flushes to the backend |
| `MONITOR_METRICS` | true | Set `false` to disable metric collection |
| `MONITOR_SECURITY` | true | Set `false` to disable security-log collection |
| `MONITOR_TLS_VERIFY` | true | Set `false` only for self-signed lab certs |
| `MONITOR_BUFFER_FILE` | /var/lib/monitor-agent/buffer.ndjson | Offline buffer path |

### C2. Option 2 — .deb package
On a machine that has the repo and `dpkg-deb`:
```bash
cd packaging
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm
./build-deb.sh                       # -> dist/monitor-agent_1.0.0_all.deb
```
On the target server:
```bash
sudo dpkg -i monitor-agent_1.0.0_all.deb || sudo apt-get -f install
sudo nano /etc/monitor-agent/agent.yaml     # set server_url + api_key
sudo systemctl enable --now monitor-agent
```

---

## Part D — RBAC: roles & user management

### Roles
| Role | Capabilities |
|------|--------------|
| **admin** | Everything: manage users & roles, register/delete servers, resolve alerts, view all data |
| **operator** | Register servers, resolve alerts, view all data. Cannot manage users or delete servers |
| **viewer** | Read-only: view servers, metrics, security events, alerts |

### Manage users (admin)
In the dashboard, admins see a **Users** tab to:
- add a user (email + password + role),
- change a user's role inline,
- reset a user's password,
- delete a user (the last admin and your own account are protected).

Every user gets a JWT at login that encodes their role; the backend enforces role
checks on protected endpoints, and admin actions are written to the `audit_log` table.

### Change the seeded admin password
First login as `admin@example.com` / `admin123`, then either use the Users tab to
reset it, or re-run the migrate with a strong password (Part B2). Always change
`JWT_SECRET` (backend env) before production.

### Relevant API endpoints
| Method & path | Role |
|---------------|------|
| `POST /api/v1/auth/login` | public |
| `GET /api/v1/auth/me` | any authenticated |
| `GET /api/v1/users` | admin |
| `POST /api/v1/users` | admin |
| `PATCH /api/v1/users/:id/role` | admin |
| `PATCH /api/v1/users/:id/password` | admin |
| `PATCH /api/v1/users/me/password` | self |
| `DELETE /api/v1/users/:id` | admin |
| `POST /api/v1/servers` | admin, operator |
| `DELETE /api/v1/servers/:id` | admin |
| `POST /api/v1/alerts/:id/resolve` | admin, operator |

---

## Part E — Troubleshooting

**Dashboard: `Failed to proxy http://localhost:4000 ... ECONNREFUSED`**
The dashboard's proxy target is wrong. In Docker it must be `http://backend:4000`
(service name), and because Next bakes external rewrites at build time it must be set
as a **build arg**. Rebuild: `docker compose build --no-cache dashboard && docker compose up -d`.
For local dev, start with `BACKEND_URL=http://localhost:4000 npm run dev`.

**Backend exits right after `Applying schema... Done`**
Check `docker compose logs backend`. If migrate throws (e.g. DB not ready), the API
never starts — the command is `migrate.js && node dist/main.js`. Ensure the DB is
healthy first (compose waits via healthcheck).

**migrate: `ENOENT ... /database/schema.sql`**
The backend image can't reach `../database`. Compose mounts the schema and sets
`SCHEMA_PATH=/app/database/schema.sql`. Keep that volume + env, or set `SCHEMA_PATH`
to wherever the file is.

**Agent service: `status=203/EXEC`**
systemd couldn't execute the command. Causes:
- Node not at the path in `ExecStart`. Use a system-wide install at `/usr/bin/node`.
- **nvm node** lives under `/root/.nvm/...`, which an unprivileged service user cannot
  read — install Node system-wide (Part C1 step 1) instead of relying on nvm.
- The script path is wrong: `ls -l /opt/monitor-agent/monitor-agent.js`.
Test manually: `sudo -u monitor-agent /usr/bin/node /opt/monitor-agent/monitor-agent.js`.

**Agent connects but server stays offline / `buffering` warnings**
- `MONITOR_SERVER_URL` must be reachable from the agent host (not `localhost` unless
  the backend is on the same box). Check firewall/port 4000.
- For HTTP backends keep the URL `http://`; for self-signed TLS set
  `MONITOR_TLS_VERIFY=false` (lab only).

**No security events appear**
The agent reads SSH/sudo/UFW via journald; the systemd unit grants the `adm` and
`systemd-journal` groups. Generate a test event (e.g. an SSH login) and confirm it
appears on the server's detail page.

---

*Default credentials and secrets in this guide are for first-run only. Change
`JWT_SECRET`, the database password, and the admin password before any real deployment.*
