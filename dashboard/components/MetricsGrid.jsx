'use client';
import MetricCard from '@/components/ui/MetricCard';
import FeedbackState from '@/components/ui/FeedbackState';

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
    <>
    {loading && <FeedbackState kind="loading" title="Loading security summary…" />}
    <div className="metrics-grid" aria-busy={loading}>
      {metrics.map((metric) =>
        widgets[metric.name] ? (
          <MetricCard key={metric.name} label={metric.label} value={loading ? null : metric.value}
            tone={metric.color === 'crit' ? 'critical' : metric.color === 'warn' ? 'warning' : 'neutral'} detail={metric.description} />
        ) : null
      )}
    </div>
    </>
  );
}
