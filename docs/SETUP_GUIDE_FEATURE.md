# Agent Setup Guide Feature

## Overview

An interactive step-by-step setup guide for installing and configuring the monitoring agent on Ubuntu servers. Uses actual production configuration with systemd service management.

## Location

**URL**: `/setup` or **Setup Guide** in sidebar navigation

**Access**: Click "Setup Guide" in the main navigation sidebar

## 12 Step-by-Step Process

1. **Prerequisites** — System requirements and dependencies
2. **Update System & Install Node.js** — System packages and Node.js LTS
3. **Create System User** — System user for service (`monitor-agent`)
4. **Prepare Build Environment** — Setup `/var/www/packaging` directory
5. **Copy Agent Script** — Copy `monitor-agent.js` from `agent/standalone/`
6. **Set Permissions** — Configure file and directory permissions
7. **Create Systemd Service** — Service unit file with resource limits
8. **Configure Environment** — Set backend URL and API key
9. **Enable & Start Service** — Activate the service
10. **Verify Installation** — Check service status and logs
11. **Monitor Logs** — Real-time log monitoring commands
12. **Troubleshooting & Maintenance** — Service management and debugging

## Key Configuration

### Service Details

```
Service Name:    monitor-agent
Service User:    monitor-agent (system user)
Service File:    /etc/systemd/system/monitor-agent.service
Agent Script:    /opt/monitor-agent/monitor-agent.js
Data Directory:  /var/lib/monitor-agent
```

### Resource Limits

```
CPU Quota:       15% (CPUQuota=15%)
Memory Limit:    128MB (MemoryMax=128M)
Restart Policy:  Always (with 5 second delay)
```

### Environment Variables

```bash
MONITOR_SERVER_URL=http://YOUR_BACKEND_HOST:4000
MONITOR_API_KEY=PASTE_YOUR_API_KEY
```

### Security Features

- Runs as unprivileged system user
- No login shell, no home directory
- Read-only filesystem (except `/var/lib/monitor-agent`)
- Supplementary groups for system monitoring (adm, systemd-journal)
- NoNewPrivileges security hardening

## Features

### Interactive UI

- **Sidebar Navigation** — Jump to any step
- **One-Click Copy** — Copy all commands for each step
- **Visual Progress Bar** — See completion progress
- **Previous/Next Buttons** — Navigate through steps
- **Step Counter** — Track current position

### Quick Reference

Fast lookup for:
- Agent directory path
- Data directory path
- Service name and user
- Status check command
- Log viewing command

### Comprehensive Troubleshooting

Solutions for:
- Service won't start
- Can't connect to backend
- Service keeps restarting
- High resource usage
- Permission denied errors
- Invalid API key errors

## Installation Summary

### What Gets Installed

1. **Node.js 20.x LTS** — JavaScript runtime
2. **Monitor Agent** — System monitoring application
3. **System User** — Dedicated service account
4. **Systemd Service** — Automatic startup and management
5. **Data Directory** — `/var/lib/monitor-agent/` for persistent data

### Directory Structure

```
/opt/monitor-agent/
├── monitor-agent.js       (Main application - copied from agent/standalone/)
├── package.json          (Node.js dependencies)
└── node_modules/         (Installed packages)

/var/lib/monitor-agent/
├── logs/                 (Application logs)
└── data/                 (Persistent data)
```

### Source Files

Agent script is sourced from your repository:
```
agent/standalone/monitor-agent.js → /opt/monitor-agent/monitor-agent.js
```

### User & Permissions

- **Service User**: `monitor-agent` (UID: system-assigned)
- **Ownership**: `/opt/monitor-agent/` and `/var/lib/monitor-agent/` owned by monitor-agent
- **Permissions**: Directory mode 700 (rwx------)

## Service Management

### Basic Commands

```bash
# Check status
sudo systemctl status monitor-agent

# Start service
sudo systemctl start monitor-agent

# Stop service
sudo systemctl stop monitor-agent

# Restart service
sudo systemctl restart monitor-agent

# Enable on boot
sudo systemctl enable monitor-agent

# Disable from boot
sudo systemctl disable monitor-agent
```

### Log Viewing

```bash
# Real-time logs
journalctl -u monitor-agent -f

# Last 50 lines
journalctl -u monitor-agent -n 50

# Since specific time
journalctl -u monitor-agent --since "1 hour ago"

# With full details
journalctl -u monitor-agent -o short-precise

# Search for errors
journalctl -u monitor-agent | grep -i error
```

### Monitoring

```bash
# Check if running
sudo systemctl is-active monitor-agent

# Check if enabled
sudo systemctl is-enabled monitor-agent

# View resource usage
top -b -n 1 | grep monitor-agent

# Check process details
ps aux | grep "node.*monitor-agent"
```

## Configuration

### Backend Connection

Edit `/etc/systemd/system/monitor-agent.service`:

```ini
Environment=MONITOR_SERVER_URL=http://YOUR_BACKEND_HOST:4000
Environment=MONITOR_API_KEY=your_api_key_here
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart monitor-agent
```

### Resource Limits

To adjust CPU or memory limits, edit the service file:

```ini
CPUQuota=15%         # Limit to 15% of one CPU core
MemoryMax=128M       # Limit to 128MB RAM
```

### Restart Policy

Current configuration:
```ini
Restart=always       # Always restart on failure
RestartSec=5         # Wait 5 seconds before restarting
```

## Troubleshooting Guide

### Service Won't Start

```bash
# Check recent errors
journalctl -u monitor-agent -n 50

# Check file permissions
ls -la /opt/monitor-agent/
sudo ls -la /var/lib/monitor-agent/

# Verify service file
sudo cat /etc/systemd/system/monitor-agent.service
```

### Can't Connect to Backend

```bash
# Test connectivity
curl http://YOUR_BACKEND_HOST:4000

# Check DNS resolution
nslookup YOUR_BACKEND_HOST

# Check firewall rules
sudo ufw status
sudo iptables -L -n

# View connection logs
journalctl -u monitor-agent | grep -i connect
```

### Service Keeps Restarting

```bash
# Check logs for crash reasons
journalctl -u monitor-agent -f

# Verify Node.js installation
node --version
npm --version

# Check script syntax
node -c /opt/monitor-agent/monitor-agent.js
```

### High CPU/Memory Usage

```bash
# Check current usage
ps aux | grep monitor-agent

# Monitor in real-time
top -p $(pgrep -f "node.*monitor-agent")

# Check ulimits
cat /proc/$(pgrep -f "node.*monitor-agent")/limits

# Increase resource limits in service file
```

### Permission Denied Errors

```bash
# Fix ownership
sudo chown -R monitor-agent:monitor-agent /opt/monitor-agent
sudo chown -R monitor-agent:monitor-agent /var/lib/monitor-agent

# Fix permissions
sudo chmod 755 /opt/monitor-agent
sudo chmod 700 /var/lib/monitor-agent

# Verify
ls -la /opt/monitor-agent/
sudo ls -la /var/lib/monitor-agent/
```

### Invalid API Key

```bash
# Edit service file
sudo nano /etc/systemd/system/monitor-agent.service

# Update the MONITOR_API_KEY line
Environment=MONITOR_API_KEY=new_key_here

# Apply changes
sudo systemctl daemon-reload
sudo systemctl restart monitor-agent
```

## Security Considerations

### Current Hardening

- ✅ Dedicated system user (no login)
- ✅ Limited filesystem access
- ✅ Resource limits (CPU, memory)
- ✅ No new privileges flag
- ✅ Proper file permissions

### Group Memberships

The service includes supplementary groups:
- `adm` — Read system logs
- `systemd-journal` — Access journal logs

### Best Practices

- Never run as root
- Use strong API keys
- Regularly rotate credentials
- Monitor service logs
- Keep Node.js updated
- Restrict network access

## Deployment Checklist

- [ ] Ubuntu 20.04+ installed
- [ ] sudo access available
- [ ] Internet connectivity to backend
- [ ] Backend URL known
- [ ] API key obtained
- [ ] Firewall allows outbound 4000
- [ ] Disk space available (100MB+)
- [ ] Node.js 20.x installed
- [ ] System user created
- [ ] Agent script in place
- [ ] Service file created
- [ ] Service enabled and running
- [ ] Logs show successful connection

## Post-Installation

### Monitor Dashboard

Once service is running, check the backend dashboard:
1. Server should appear in "Overview"
2. Metrics should update every collection interval
3. Security events should appear in logs

### Scaling

To deploy to multiple servers:
1. Follow setup guide on each server
2. Use unique `MONITOR_API_KEY` per server
3. Same `MONITOR_SERVER_URL` for all
4. Verify each in dashboard

### Maintenance

Regular tasks:
- [ ] Check logs weekly for errors
- [ ] Monitor resource usage
- [ ] Test backend connectivity monthly
- [ ] Review and rotate API keys quarterly
- [ ] Update Node.js annually

## Support

For issues:
1. Check troubleshooting section on setup page
2. View detailed logs: `journalctl -u monitor-agent -f`
3. Verify configuration: `sudo cat /etc/systemd/system/monitor-agent.service`
4. Test connectivity: `curl http://YOUR_BACKEND:4000`
5. Contact your system administrator
