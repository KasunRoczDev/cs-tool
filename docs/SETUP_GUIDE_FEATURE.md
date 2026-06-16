# Agent Setup Guide Feature

## Overview

An interactive step-by-step setup guide has been added to the dashboard to help users install and configure the monitoring agent on Ubuntu servers.

## Location

**URL**: `/setup` or **Setup Guide** in sidebar navigation

**Access**: Click "Setup Guide" in the main navigation sidebar

## Features

### 12 Step-by-Step Instructions

1. **Prerequisites** — System requirements
2. **Update System** — Install dependencies
3. **Install Node.js** — Runtime installation
4. **Create Agent Directory** — Directory structure
5. **Clone Agent Repository** — Repository setup
6. **Configuration** — Config file setup
7. **Setup Environment** — .env file creation
8. **Test Agent** — Initial testing
9. **Setup Systemd Service** — Service creation
10. **Start Agent Service** — Service activation
11. **Verify Installation** — Verification steps
12. **Configure Firewall** — Firewall rules

### Interactive Features

- **Sidebar Navigation** — Click any step to jump to it
- **Copy Code Snippets** — One-click copy of all commands
- **Visual Progress** — Progress bar shows completion
- **Navigation Buttons** — Previous/Next step buttons
- **Step Counter** — Shows current step and total steps

### Quick Reference Section

- Agent Directory path
- Service name
- Log file location
- Config file location
- Status check command
- Log viewing command

### Troubleshooting Section

Includes solutions for common issues:
- Agent won't start
- Can't connect to backend
- High CPU/Memory usage
- Port already in use

## Code Snippets Included

All commands are ready-to-copy:
- System updates
- Node.js installation
- Directory creation
- Git clone
- npm install
- Configuration
- Environment setup
- Service creation
- Service management
- Verification commands
- Firewall configuration

## Customization

To customize the setup guide, edit `/app/(app)/setup/page.jsx`:

### Add New Step

```javascript
{
  id: 13,
  title: 'Your Step Title',
  description: 'Step description',
  code: `# Your commands here
your-command --flag`,
},
```

### Change Prerequisites

Update the Prerequisites section (step 1) with your requirements

### Update Backend URL Example

Replace references in Configuration and Environment Setup steps:
- `http://your-backend:3000` → Your actual backend URL
- `your-unique-api-key-here` → Default key placeholder

### Add More Troubleshooting Tips

Add items to the Troubleshooting section with issue and solution

## User Experience

### For New Users
- Clear step-by-step progression
- Code is ready to copy/paste
- Links to official documentation
- Common issues and solutions

### For Admins
- Provides standardized installation process
- Ensures consistent configuration across servers
- Reduces support tickets
- Can be shared via URL `/setup`

### For Teams
- Self-service documentation
- No need to maintain separate wiki
- Always up-to-date with codebase
- Interactive and user-friendly

## Integration with Backend

The guide provides placeholders for:
- `BACKEND_URL` — Configure with your backend address
- `API_KEY` — Unique key from server registration
- `SERVER_NAME` — Custom identifier

Update these in the Configuration and Environment Setup steps based on your deployment.

## What Gets Installed

Following this guide installs:
- Node.js 20.x LTS
- Monitoring Agent (from git repository)
- Agent dependencies (via npm)
- Systemd service (for auto-start on reboot)
- Log management (to `/opt/monitoring-agent/logs/`)

## Post-Installation Verification

The guide includes verification steps to confirm:
- ✓ Service is active and running
- ✓ Logs show successful metric collection
- ✓ Health endpoint responds
- ✓ Process is running
- ✓ Firewall allows communication

## Logs and Troubleshooting

Common log locations:
- **Application logs**: `/opt/monitoring-agent/logs/agent.log`
- **Error logs**: `/opt/monitoring-agent/logs/agent-error.log`
- **Systemd logs**: `journalctl -u monitoring-agent`

## Commands Reference

```bash
# Check status
sudo systemctl status monitoring-agent

# Start/stop service
sudo systemctl start monitoring-agent
sudo systemctl stop monitoring-agent

# Restart service
sudo systemctl restart monitoring-agent

# Enable on boot
sudo systemctl enable monitoring-agent

# View logs (live)
journalctl -u monitoring-agent -f

# View recent logs
journalctl -u monitoring-agent -n 50

# Check if process is running
ps aux | grep "node.*index.js"
```

## Environment Variables

Key variables configured in `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `BACKEND_URL` | Backend server address | `http://192.168.1.100:3000` |
| `API_KEY` | Unique server identifier | `sk_live_abc123def456` |
| `SERVER_NAME` | Display name in dashboard | `production-web-01` |
| `POLL_INTERVAL` | Data collection interval (ms) | `30000` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Firewall Configuration

The guide sets up firewall rules for:
- **Port 9000** — Agent health check endpoint
- **Outbound 3000** — Backend API communication
- **Outbound 443** — HTTPS for updates

## Service Management

The guide creates a systemd service that:
- Runs as the current user
- Restarts automatically on failure
- Starts on system boot
- Logs to `/opt/monitoring-agent/logs/`
- Runs from `/opt/monitoring-agent/`

## System Requirements Validation

Before starting, ensure:
- Ubuntu 20.04 LTS or newer (`lsb_release -a`)
- sudo privileges (`sudo -v`)
- 2+ CPU cores
- 2GB+ RAM
- 50MB+ disk space in `/opt/`
- Network connectivity to backend

## Advanced Configuration

After following basic setup, you can:
- Adjust `POLL_INTERVAL` for different collection frequencies
- Configure log rotation in systemd
- Set up monitoring for agent itself
- Create backup of configuration
- Deploy to multiple servers using automation

## Updating the Agent

To update to latest version:

```bash
cd /opt/monitoring-agent
git pull origin main
npm install --production
sudo systemctl restart monitoring-agent
```

## Uninstalling

To remove the agent:

```bash
# Stop the service
sudo systemctl stop monitoring-agent
sudo systemctl disable monitoring-agent

# Remove service file
sudo rm /etc/systemd/system/monitoring-agent.service
sudo systemctl daemon-reload

# Remove agent directory
sudo rm -rf /opt/monitoring-agent
```

## Support

If issues occur:
1. Check logs: `journalctl -u monitoring-agent -n 50`
2. Verify configuration: `cat /opt/monitoring-agent/.env`
3. Test backend connectivity: `curl http://your-backend:3000/health`
4. Review troubleshooting section on the page
