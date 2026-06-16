'use client';

import { useState, useEffect } from 'react';
import DashboardCustomizer from '@/components/DashboardCustomizer';
import MetricsGrid from '@/components/MetricsGrid';
import SecurityEventTimeline from '@/components/SecurityEventTimeline';
import { useDashboard } from '@/lib/useDashboard';

// Sample data generator for demonstration
function generateSampleEvents(count = 50) {
  const types = ['alert', 'incident', 'log'];
  const sources = ['Firewall', 'IDS', 'Log Server', 'Auth Service', 'API Gateway'];
  const severities = ['Low', 'Medium', 'High', 'Critical'];
  const messages = [
    'Unauthorized access attempt detected',
    'Multiple failed login attempts',
    'Suspicious network activity detected',
    'Certificate expiration warning',
    'Brute force attack detected',
    'SQL injection attempt blocked',
    'DDoS attack in progress',
    'Malware signature detected',
    'Configuration change detected',
    'Data exfiltration attempt blocked',
  ];

  const events = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const date = new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000);
    events.push({
      id: `event-${i}`,
      timestamp: date.toISOString(),
      type: types[Math.floor(Math.random() * types.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      severity: severities[Math.floor(Math.random() * severities.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
      title: messages[Math.floor(Math.random() * messages.length)],
    });
  }

  return events;
}

export default function SecurityPage() {
  const { widgets } = useDashboard();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Simulate loading events
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      setEvents(generateSampleEvents(150));
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Calculate metrics
  const metrics = {
    events: events.length,
    alerts: events.filter((e) => e.type === 'alert').length,
    incidents: events.filter((e) => e.type === 'incident').length,
  };

  return (
    <div>
      <div className="page-head">
        <h2>Security Dashboard</h2>
      </div>

      <DashboardCustomizer />

      <MetricsGrid
        events={metrics.events}
        alerts={metrics.alerts}
        incidents={metrics.incidents}
        loading={loading}
      />

      {widgets.securityTimeline && (
        <SecurityEventTimeline events={events} loading={loading} />
      )}

      {/* Demo widget - Recent Alerts */}
      {widgets.recentAlerts && (
        <div style={{ marginTop: '24px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Recent Security Alerts
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
            {events
              .filter((e) => e.type === 'alert')
              .slice(0, 6)
              .map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '12px',
                    borderLeft: '3px solid var(--warn)',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                    {new Date(alert.timestamp).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>
                    {alert.message}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {alert.source} • Severity: {alert.severity}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
