'use client';

import { useState } from 'react';
import { useDashboard } from '@/lib/useDashboard';

// Mirrors agent/INSTALL.md — the packaged .deb install flow. Keep these two
// in sync; this page is the in-app copy of that guide, not an alternate one.
const steps = [
  {
    id: 1,
    title: 'Prerequisites',
    description: 'What the target server and build machine need',
    content: (
      <div>
        <h4 style={{ marginTop: 0 }}>Target server:</h4>
        <ul>
          <li>Ubuntu 20.04+ / Debian 11+ (other systemd Linux works too)</li>
          <li>Node.js ≥ 18 (the .deb depends on it — <code>apt-get -f install</code> pulls it in if missing)</li>
          <li>sudo / root</li>
          <li>Outbound HTTPS (443) to this platform&apos;s <code>server_url</code></li>
        </ul>
        <h4>Build machine:</h4>
        <ul>
          <li>Any Ubuntu/Debian box with <code>dpkg-deb</code> and <code>bash</code> — a CI runner or your workstation, doesn&apos;t need to be the target server</li>
        </ul>
        <h4>Optional, only if you enable the matching collector (Step 6):</h4>
        <ul>
          <li><code>lynis</code>, <code>libfcgi-bin</code> — host-hardening audit / PHP-FPM socket probe</li>
          <li><code>postgresql-client</code>, <code>redis-tools</code>, <code>openssl</code>, <code>docker</code> — service-metrics probes</li>
        </ul>
      </div>
    ),
  },
  {
    id: 2,
    title: 'Get a server API key',
    description: 'Issued once per server from this dashboard',
    content: (
      <div>
        <p>
          Click <strong>+ Add server</strong> to create the server record — the response includes
          a one-time <code>agt_...</code> API key. Copy it now; it isn&apos;t stored in plaintext
          and can&apos;t be viewed again later.
        </p>
        <p>
          If it&apos;s lost before it makes it into <code>agent.yaml</code> (e.g. the config file
          was wiped by a reinstall), open that server&apos;s detail page and use{' '}
          <strong>Regenerate API key</strong> instead of re-registering the server — it issues a
          fresh key in place and keeps the server&apos;s existing history.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Keep the key secret — it&apos;s the agent&apos;s only credential.</p>
      </div>
    ),
  },
  {
    id: 3,
    title: 'Build the .deb package',
    description: 'From the platform repository, on the build machine',
    code: `cd packaging
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm
./build-deb.sh
# -> dist/monitor-agent_<version>_all.deb

# Copy it to the target server
scp dist/monitor-agent_*_all.deb user@your-server:/tmp/`,
  },
  {
    id: 4,
    title: 'Install on the target server',
    description: 'Installs as a systemd service, does not start it yet',
    code: `sudo dpkg -i /tmp/monitor-agent_*_all.deb

# If nodejs (or another dependency) is missing, let apt resolve it:
sudo apt-get -f install`,
    content: (
      <div>
        <p style={{ marginTop: 0 }}>The package&apos;s <code>postinst</code> automatically:</p>
        <ul>
          <li>creates the dedicated <code>monitor-agent</code> system user (no login, no home)</li>
          <li>creates the offline buffer dir <code>/var/lib/monitor-agent/</code></li>
          <li>locks down <code>/etc/monitor-agent/</code> and <code>agent.yaml</code></li>
          <li>installs the agent&apos;s Node dependencies</li>
          <li>enables the service — but does not start it yet, since it isn&apos;t configured</li>
        </ul>
      </div>
    ),
  },
  {
    id: 5,
    title: 'Configure the agent',
    description: 'Set the two required fields',
    code: `sudo nano /etc/monitor-agent/agent.yaml`,
    content: (
      <div>
        <pre style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
{`server_url: https://your-platform-host   # this platform's base URL (HTTPS in prod)
api_key: agt_xxxxxxxxxxxxxxxxxxxx        # the key from Step 2`}
        </pre>
        <p>
          <code>api_key</code> is mandatory — the agent refuses to start without it (it can also be
          supplied via the <code>MONITOR_API_KEY</code> environment variable instead). Keep{' '}
          <code>tls_verify: true</code> in production; only set it to <code>false</code> against a
          self-signed lab cert.
        </p>
      </div>
    ),
  },
  {
    id: 6,
    title: 'Optional collectors',
    description: 'PHP-FPM, Lynis, and service/application metrics — all off by default',
    content: (
      <div>
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '13px' }}>
          Every collector below is opt-in; leave a section out and that data just stays blank on
          the dashboard. See <code>agent/INSTALL.md</code> in the repository for the full reference,
          including every service-metrics probe (Postgres, Redis, BullMQ, Docker, TLS expiry).
        </p>
        <h4>PHP-FPM pool status</h4>
        <pre style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
{`fpm:
  enabled: true
  pools:
    - name: www
      status_url: http://127.0.0.1/fpm-status   # restrict to localhost`}
        </pre>
        <h4>Lynis host-hardening audit</h4>
        <pre style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
{`lynis:
  enabled: true
  run: true               # agent runs \`lynis audit system\` itself
  interval_hours: 24`}
        </pre>
        <h4>Service / application metrics</h4>
        <pre style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
{`service_metrics:
  enabled: true
  postgres:
    url: postgres://user:pass@127.0.0.1:5432/yourdb
  redis:
    url: redis://127.0.0.1:6379`}
        </pre>
        <p style={{ fontSize: '12px', color: 'var(--muted)' }}>Restart after any config change (Step 7).</p>
      </div>
    ),
  },
  {
    id: 7,
    title: 'Start and enable the service',
    description: 'Enable at boot and start now',
    code: `sudo systemctl enable --now monitor-agent
sudo systemctl status monitor-agent`,
    content: (
      <p>
        The unit auto-restarts on failure and is resource-capped (15% CPU, 128MB RAM) and hardened
        (<code>NoNewPrivileges</code>, <code>ProtectSystem=strict</code>, <code>ProtectHome</code>),
        with read access to auth logs/journal via the <code>adm</code> and{' '}
        <code>systemd-journal</code> groups.
      </p>
    ),
  },
  {
    id: 8,
    title: 'Verify it&#39;s working',
    description: 'Confirm the agent connected and is sending data',
    code: `journalctl -u monitor-agent -f
# look for: [agent] starting -> https://your-platform-host

systemctl is-active monitor-agent

# offline buffer should stay small/empty once the server is reachable
ls -la /var/lib/monitor-agent/`,
    content: (
      <p>
        Then confirm the server shows <strong>online</strong> with incoming metrics on this
        dashboard — data should arrive within <code>send_interval</code> (default 30s).
      </p>
    ),
  },
  {
    id: 9,
    title: 'Upgrading',
    description: 'Rebuild, copy over, reinstall',
    code: `sudo dpkg -i monitor-agent_<new-version>_all.deb
sudo systemctl restart monitor-agent   # dpkg does not restart a running service`,
    content: (
      <p>
        <code>agent.yaml</code> is a conffile, so <code>server_url</code>/<code>api_key</code> are
        preserved across upgrades — dpkg only prompts if <em>both</em> you and the new package
        changed it. Keep your version (default) unless you specifically want the packaged
        defaults. Avoid <code>dpkg -P</code> / <code>apt purge</code> for routine updates — purge
        deliberately deletes the config; use plain <code>dpkg -i</code> or <code>dpkg -r</code>{' '}
        instead.
      </p>
    ),
  },
  {
    id: 10,
    title: 'Uninstall',
    description: 'Remove vs. purge',
    code: `# Remove the package, keep config + buffered data
sudo apt remove monitor-agent

# Remove everything, including config, buffer, and the monitor-agent user
sudo apt purge monitor-agent`,
  },
];

const troubleshooting = [
  {
    title: "Service won't start; log says \"api_key is required\"",
    body: (
      <>
        <code>api_key</code> is unset in <code>agent.yaml</code> (or <code>MONITOR_API_KEY</code>).
        Set it, then <code>sudo systemctl restart monitor-agent</code>.
      </>
    ),
  },
  {
    title: 'dpkg error about missing nodejs',
    body: <>Run <code>sudo apt-get -f install</code>, or install Node 18+ first (Step 1).</>,
  },
  {
    title: 'Server shows offline, buffer file growing',
    body: (
      <>
        Agent can&apos;t reach <code>server_url</code> — check egress/DNS/firewall and{' '}
        <code>tls_verify</code>. Buffered data flushes automatically once connectivity returns.
      </>
    ),
  },
  {
    title: 'TLS handshake errors',
    body: (
      <>
        Self-signed cert — set <code>tls_verify: false</code> for a lab only, or install a
        trusted cert.
      </>
    ),
  },
  {
    title: 'No security events',
    body: (
      <>
        Confirm <code>security_logs: true</code> and that the unit can read logs (it joins{' '}
        <code>adm</code>/<code>systemd-journal</code>). Check the <code>auth_log</code> path /{' '}
        <code>use_journald</code>.
      </>
    ),
  },
  {
    title: 'FPM / Lynis / service metrics blank',
    body: (
      <>
        Collector isn&apos;t <code>enabled</code>, or its dependency is missing (<code>lynis</code>,{' '}
        <code>libfcgi-bin</code>, <code>psql</code>, <code>redis-cli</code>, <code>openssl</code>,{' '}
        <code>docker</code>).
      </>
    ),
  },
  {
    title: 'Edits to config ignored',
    body: <>Restart after changes: <code>sudo systemctl restart monitor-agent</code>.</>,
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
          Packaged (.deb) install for Ubuntu/Debian servers — see <code>agent/INSTALL.md</code> in
          the repository for the full reference.
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
            {currentStep.code && (
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
              </div>
            )}
            {currentStep.content && <div>{currentStep.content}</div>}
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
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--ok)' }}>/usr/lib/monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--warn)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Config File</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--warn)' }}>/etc/monitor-agent/agent.yaml</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--warn)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Data Directory</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--warn)' }}>/var/lib/monitor-agent</div>
          </div>
          <div style={{ background: 'var(--panel-2)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Service Name</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>monitor-agent</div>
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
          {troubleshooting.map((t, i) => (
            <div key={i}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>{t.title}</div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{t.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
