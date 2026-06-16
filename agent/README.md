# Monitor Agent (Ubuntu)

Lightweight Node.js agent that collects system metrics and security events and
streams them to the central monitoring platform.

## Collected data

- **Metrics** (every `metrics_interval`s): CPU %, memory %, disk %, network in/out (bytes/s), 1-min load average.
- **Security events** (continuous): SSH logins, SSH failed logins, sudo usage, UFW firewall blocks. Passwords are never captured.

## Reliability

- Batches data and flushes every `send_interval`s.
- Retries failed transmissions and **buffers to disk** (`buffer_file`) so nothing is lost across outages or restarts.
- Runs under systemd with auto-restart.

## Quick run (without packaging)

```bash
cd agent
npm install
MONITOR_CONFIG=./config/agent.example.yaml \
MONITOR_SERVER_URL=http://localhost:4000 \
MONITOR_API_KEY=agt_xxx \
npm start
```

## Tests

```bash
npm test
```

## Install as a package

See `../packaging/` to build the `.deb`. After install:

```bash
sudo nano /etc/monitor-agent/agent.yaml   # set server_url + api_key
sudo systemctl enable --now monitor-agent
journalctl -u monitor-agent -f
```
