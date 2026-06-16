'use client';

import { useDashboard } from '@/lib/useDashboard';

export default function MetricsGrid({ events = 0, alerts = 0, incidents = 0, loading = false }) {
  const { widgets } = useDashboard();

  const metrics = [
    {
      name: 'eventCount',
      label: 'Security Events',
      value: events,
      color: 'accent',
      description: 'Total events',
    },
    {
      name: 'alertCount',
      label: 'Active Alerts',
      value: alerts,
      color: 'warn',
      description: 'Current alerts',
    },
    {
      name: 'incidentCount',
      label: 'Incidents',
      value: incidents,
      color: 'crit',
      description: 'Active incidents',
    },
  ];

  return (
    <div className="metrics-grid">
      {metrics.map((metric) =>
        widgets[metric.name] ? (
          <div key={metric.name} className="metric-card">
            <h3>{metric.label}</h3>
            <div className="value" style={{ color: `var(--${metric.color})` }}>
              {loading ? '...' : metric.value}
            </div>
            <div className="trend">{metric.description}</div>
          </div>
        ) : null
      )}
    </div>
  );
}
