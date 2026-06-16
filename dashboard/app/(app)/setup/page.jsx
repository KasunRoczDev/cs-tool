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
          <li>curl or wget installed</li>
          <li>Internet connectivity to backend server</li>
        </ul>
        <h4>Recommended:</h4>
        <ul>
          <li>2+ CPU cores</li>
          <li>2GB+ RAM</li>
          <li>50MB disk space</li>
        </ul>
      </div>
    ),
  },
  {
    id: 2,
    title: 'Update System',
    description: 'Update package lists and install dependencies',
    code: `# Update package lists
sudo apt update
sudo apt upgrade -y

# Install required packages
sudo apt install -y curl wget git build-essential`,
  },
  {
    id: 3,
    title: 'Install Node.js',
    description: 'Install Node.js runtime (required for agent)',
    code: `# Install Node.js (LTS version)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version`,
  },
  {
    id: 4,
    title: 'Create Agent Directory',
    description: 'Create a dedicated directory for the agent',
    code: `# Create directory structure
sudo mkdir -p /opt/monitoring-agent
sudo chown $USER:$USER /opt/monitoring-agent
cd /opt/monitoring-agent

# Create necessary subdirectories
mkdir -p logs config data scripts`,
  },
  {
    id: 5,
    title: 'Clone Agent Repository',
    description: 'Clone the monitoring agent from repository',
    code: `# Navigate to agent directory
cd /opt/monitoring-agent

# Clone the repository (replace with your repo URL)
git clone https://github.com/your-org/monitoring-agent.git .

# Install dependencies
npm install --production`,
  },
  {
    id: 6,
    title: 'Configuration',
    description: 'Configure the agent with server details',
    code: `# Copy example config
cp config.example.js config.js

# Edit configuration with your details
nano config.js

# Key settings to configure:
# - BACKEND_URL: http://your-backend:3000
# - API_KEY: Your unique server API key
# - SERVER_NAME: Identifier for this server
# - POLL_INTERVAL: Data collection interval (default 30s)`,
  },
  {
    id: 7,
    title: 'Setup Environment',
    description: 'Create .env file with backend connection details',
    code: `# Create .env file
cat > .env << EOF
BACKEND_URL=http://your-backend-server:3000
API_KEY=your-unique-api-key-here
SERVER_NAME=ubuntu-server-01
POLL_INTERVAL=30000
LOG_LEVEL=info
EOF

# Verify file was created
cat .env`,
  },
  {
    id: 8,
    title: 'Test Agent',
    description: 'Run the agent in foreground to test',
    code: `# Run agent in test mode
node index.js

# You should see:
# ✓ Connected to backend
# ✓ Starting metric collection
# ✓ Sending metrics...

# Press Ctrl+C to stop when verification is complete`,
  },
  {
    id: 9,
    title: 'Setup Systemd Service',
    description: 'Create systemd service for automatic startup',
    code: `# Create systemd service file
sudo tee /etc/systemd/system/monitoring-agent.service > /dev/null << EOF
[Unit]
Description=Monitoring Agent Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/monitoring-agent
ExecStart=/usr/bin/node /opt/monitoring-agent/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/opt/monitoring-agent/logs/agent.log
StandardError=append:/opt/monitoring-agent/logs/agent-error.log

[Install]
WantedBy=multi-user.target
EOF

# Update service permissions
sudo systemctl daemon-reload`,
  },
  {
    id: 10,
    title: 'Start Agent Service',
    description: 'Enable and start the agent service',
    code: `# Enable service to start on boot
sudo systemctl enable monitoring-agent

# Start the service
sudo systemctl start monitoring-agent

# Check service status
sudo systemctl status monitoring-agent

# View real-time logs
journalctl -u monitoring-agent -f`,
  },
  {
    id: 11,
    title: 'Verify Installation',
    description: 'Confirm agent is running and connected',
    code: `# Check service is active
sudo systemctl is-active monitoring-agent

# Check recent logs
sudo tail -20 /opt/monitoring-agent/logs/agent.log

# Test API connectivity
curl http://localhost:9000/health

# Check if metrics are being collected
ps aux | grep "node.*index.js"`,
  },
  {
    id: 12,
    title: 'Configure Firewall',
    description: 'Allow agent communication through firewall',
    code: `# If using UFW firewall
sudo ufw allow 9000/tcp

# If using iptables
sudo iptables -A INPUT -p tcp --dport 9000 -j ACCEPT

# Verify firewall rules
sudo ufw status
# OR
sudo iptables -L -n`,
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
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ok)' }}>/opt/monitoring-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--warn)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Service Name</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--warn)' }}>monitoring-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Log File</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>/opt/monitoring-agent/logs/agent.log</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--crit)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Config File</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--crit)' }}>/opt/monitoring-agent/.env</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--ok)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Check Status</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ok)' }}>sudo systemctl status monitoring-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>View Logs</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>journalctl -u monitoring-agent -f</div>
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
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Agent won't start</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Check logs: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>journalctl -u monitoring-agent -n 50</code>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Can't connect to backend</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Verify BACKEND_URL in .env and check firewall: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>curl http://backend:3000</code>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>High CPU/Memory usage</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Increase POLL_INTERVAL in .env (default 30000ms = 30 seconds)
            </div>
          </div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Port already in use</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Kill existing process: <code style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: '3px' }}>sudo kill -9 $(lsof -t -i:9000)</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
