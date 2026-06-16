'use client';

import { useState } from 'react';
import { useDashboard } from '@/lib/useDashboard';

const steps = [
  {
    id: 1,
    title: 'Prerequisites',
    description: 'Ensure your Ubuntu server meets these requirements',
    content: (
      <div>
        <h4 style={{ marginTop: 0 }}>Required:</h4>
        <ul>
          <li>Ubuntu 20.04 LTS or later</li>
          <li>sudo privileges</li>
          <li>Internet connectivity to backend server</li>
          <li>Backend server address (e.g., http://YOUR_BACKEND_HOST:4000)</li>
          <li>API Key from monitoring platform</li>
        </ul>
        <h4>System Requirements:</h4>
        <ul>
          <li>2+ CPU cores (limited to 15% per systemd config)</li>
          <li>256MB+ RAM (limited to 128MB per systemd config)</li>
          <li>100MB disk space in /var/lib/</li>
        </ul>
      </div>
    ),
  },
  {
    id: 2,
    title: 'Update System & Install Node.js',
    description: 'Update packages and install Node.js runtime',
    code: `# Update package lists
sudo apt update
sudo apt upgrade -y

# Install Node.js (LTS version)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version`,
  },
  {
    id: 3,
    title: 'Create System User',
    description: 'Create dedicated system user for the monitoring agent',
    code: `# Create system user (no login, no home directory)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin monitor-agent

# Create agent directories
sudo mkdir -p /opt/monitor-agent /var/lib/monitor-agent

# Set proper permissions and ownership
sudo chown -R monitor-agent:monitor-agent /var/lib/monitor-agent
sudo chmod 700 /var/lib/monitor-agent

# Verify user was created
id monitor-agent`,
  },
  {
    id: 4,
    title: 'Prepare Build Environment',
    description: 'Setup packaging and build directory',
    code: `# Navigate to build directory
cd /var/www/

# Create packaging directory
mkdir packaging
cd packaging

# Make scripts executable
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm

# Verify structure
ls -la`,
  },
  {
    id: 5,
    title: 'Create Agent Script',
    description: 'Create the main monitor-agent.js script',
    code: `# Create agent directory
sudo mkdir -p /opt/monitor-agent

# Create the monitor-agent.js file
sudo nano /opt/monitor-agent/monitor-agent.js

# Paste your monitoring agent code here
# The script should:
# - Collect system metrics (CPU, memory, disk, network)
# - Collect security events
# - Send data to backend via MONITOR_SERVER_URL
# - Handle errors gracefully`,
  },
  {
    id: 6,
    title: 'Set Permissions',
    description: 'Configure proper file permissions and ownership',
    code: `# Set ownership to monitor-agent user
sudo chown -R monitor-agent:monitor-agent /opt/monitor-agent

# Make the script executable
sudo chmod +x /opt/monitor-agent/monitor-agent.js

# Set proper directory permissions
sudo chmod 750 /opt/monitor-agent

# Verify permissions
ls -la /opt/monitor-agent/`,
  },
  {
    id: 7,
    title: 'Create Systemd Service',
    description: 'Create systemd service for automatic startup and management',
    code: `# Create systemd service file
sudo tee /etc/systemd/system/monitor-agent.service > /dev/null <<'EOF'
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
EOF

# Reload systemd daemon
sudo systemctl daemon-reload`,
  },
  {
    id: 8,
    title: 'Configure Environment Variables',
    description: 'Set backend URL and API key in the service',
    code: `# Edit the service file to set your backend details
sudo nano /etc/systemd/system/monitor-agent.service

# Update these lines with your values:
# Environment=MONITOR_SERVER_URL=http://YOUR_BACKEND_HOST:4000
# Environment=MONITOR_API_KEY=PASTE_YOUR_API_KEY

# Example:
# Environment=MONITOR_SERVER_URL=http://192.168.1.100:4000
# Environment=MONITOR_API_KEY=sk_live_abc123def456xyz

# After editing, reload systemd
sudo systemctl daemon-reload`,
  },
  {
    id: 9,
    title: 'Enable & Start Service',
    description: 'Enable the service to start on boot and start it now',
    code: `# Enable service to start on system boot
sudo systemctl enable monitor-agent

# Start the service immediately
sudo systemctl start monitor-agent

# Check service status
sudo systemctl status monitor-agent --no-pager`,
  },
  {
    id: 10,
    title: 'Verify Installation',
    description: 'Confirm agent is running and connected to backend',
    code: `# Check if service is active
sudo systemctl is-active monitor-agent

# View real-time logs
journalctl -u monitor-agent -f

# Press Ctrl+C to exit logs

# Check recent service status
sudo systemctl status monitor-agent`,
  },
  {
    id: 11,
    title: 'Monitor Logs',
    description: 'View and monitor agent logs for issues',
    code: `# Stream logs in real-time
journalctl -u monitor-agent -f

# View last 50 lines
journalctl -u monitor-agent -n 50

# View logs from last hour
journalctl -u monitor-agent --since "1 hour ago"

# View logs with timestamps and priorities
journalctl -u monitor-agent -o short-precise

# Search for errors
journalctl -u monitor-agent | grep -i error`,
  },
  {
    id: 12,
    title: 'Troubleshooting & Maintenance',
    description: 'Common commands for troubleshooting and service management',
    code: `# Restart the service
sudo systemctl restart monitor-agent

# Stop the service
sudo systemctl stop monitor-agent

# View service state
sudo systemctl is-active monitor-agent

# Check if service is enabled
sudo systemctl is-enabled monitor-agent

# View service configuration
sudo cat /etc/systemd/system/monitor-agent.service

# Check if process is running
ps aux | grep "node.*monitor-agent"

# Check CPU and memory usage
top -b -n 1 | grep monitor-agent`,
  },
];

export default function SetupPage() {
  const [activeStep, setActiveStep] = useState(1);
  const [copied, setCopied] = useState(null);
  const { theme } = useDashboard();

  const currentStep = steps.find((s) => s.id === activeStep);

  const copyToClipboard = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(activeStep);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="page-head">
        <h2>Agent Setup Guide</h2>
        <p style={{ margin: '8px 0 0 0', color: 'var(--muted)', fontSize: '13px' }}>
          Step-by-step installation for Ubuntu servers
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '20px', marginTop: '20px' }}>
        {/* Sidebar Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {steps.map((step) => (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              style={{
                background: activeStep === step.id ? 'var(--accent)' : 'var(--panel)',
                color: activeStep === step.id ? '#07101f' : 'var(--text)',
                border: activeStep === step.id ? 'none' : '1px solid var(--border)',
                padding: '12px',
                borderRadius: '6px',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeStep === step.id ? '600' : '500',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: '12px', opacity: 0.8 }}>Step {step.id}</div>
              <div>{step.title}</div>
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--accent)',
                color: '#07101f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: '700',
                fontSize: '14px',
              }}
            >
              {currentStep.id}
            </div>
            <div>
              <h3 style={{ margin: '0 0 4px 0' }}>{currentStep.title}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                {currentStep.description}
              </p>
            </div>
          </div>

          <div style={{ marginTop: '20px' }}>
            {currentStep.code ? (
              <div>
                <div
                  style={{
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '16px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    overflow: 'auto',
                    color: 'var(--ok)',
                    marginBottom: '12px',
                    position: 'relative',
                  }}
                >
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {currentStep.code}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(currentStep.code)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '6px 10px',
                      fontSize: '11px',
                      background: 'var(--accent)',
                      color: '#07101f',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: '600',
                    }}
                  >
                    {copied === activeStep ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '12px 0 0 0' }}>
                  💡 Tip: Click "Copy" to copy all commands above, then paste in your terminal.
                </p>
              </div>
            ) : (
              <div>{currentStep.content}</div>
            )}
          </div>

          {/* Navigation */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => setActiveStep(Math.max(1, activeStep - 1))}
              disabled={activeStep === 1}
              style={{
                background: activeStep === 1 ? 'var(--panel-2)' : 'transparent',
                color: activeStep === 1 ? 'var(--muted)' : 'var(--accent)',
                border: `1px solid ${activeStep === 1 ? 'var(--border)' : 'var(--accent)'}`,
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: activeStep === 1 ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                opacity: activeStep === 1 ? 0.5 : 1,
              }}
            >
              ← Previous
            </button>

            <div style={{ flex: 1 }} />

            <button
              onClick={() => setActiveStep(Math.min(steps.length, activeStep + 1))}
              disabled={activeStep === steps.length}
              style={{
                background: activeStep === steps.length ? 'var(--panel-2)' : 'var(--accent)',
                color: activeStep === steps.length ? 'var(--muted)' : '#07101f',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: activeStep === steps.length ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: '600',
                opacity: activeStep === steps.length ? 0.5 : 1,
              }}
            >
              Next →
            </button>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              marginTop: '16px',
              height: '4px',
              background: 'var(--panel-2)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--accent)',
                width: `${(activeStep / steps.length) * 100}%`,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '8px 0 0 0', textAlign: 'center' }}>
            Step {activeStep} of {steps.length}
          </p>
        </div>
      </div>

      {/* Quick Reference */}
      <div
        style={{
          marginTop: '24px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '16px',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--muted)', textTransform: 'uppercase' }}>
          Quick Reference
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--ok)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Agent Directory</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ok)' }}>/opt/monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--warn)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Data Directory</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--warn)' }}>/var/lib/monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Service Name</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--crit)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Service User</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--crit)' }}>monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--ok)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Check Status</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ok)' }}>sudo systemctl status monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>View Logs</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>journalctl -u monitor-agent -f</div>
          </div>
        </div>
      </div>

      {/* Troubleshooting */}
      <div
        style={{
          marginTop: '24px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '16px',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--muted)', textTransform: 'uppercase' }}>
          ⚠️ Troubleshooting
        </h3>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Service won't start</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Check logs: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>journalctl -u monitor-agent -n 50</code>
              <br /> Also verify environment variables are set correctly in service file.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Can't connect to backend</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Verify MONITOR_SERVER_URL in service file and test: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>curl http://YOUR_BACKEND_HOST:4000</code>
              <br /> Check firewall allows outbound connections on port 4000.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Service keeps restarting</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Service is configured to restart on failure. Check logs for errors: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>journalctl -u monitor-agent -f</code>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>High CPU/Memory usage</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Service is limited to 15% CPU and 128MB memory by systemd config. If hitting limits, edit: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>sudo nano /etc/systemd/system/monitor-agent.service</code>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Permission denied errors</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Verify ownership: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>sudo chown -R monitor-agent:monitor-agent /opt/monitor-agent /var/lib/monitor-agent</code>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Invalid API key error</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Edit service file and verify MONITOR_API_KEY: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>sudo nano /etc/systemd/system/monitor-agent.service</code>
              <br /> Then reload and restart: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>sudo systemctl daemon-reload && sudo systemctl restart monitor-agent</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
