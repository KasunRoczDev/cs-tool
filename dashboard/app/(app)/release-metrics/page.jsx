'use client';
import PageHeader from '@/components/PageHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import { getPageContext } from '@/lib/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import FilterBar from '@/components/ui/FilterBar';
import FormField from '@/components/ui/FormField';

const TIER_COLOR = {
  Elite: '#22c55e', High: '#3b82f6', Medium: '#eab308', Low: '#ef4444', 'N/A': '#64748b',
};
const DAY_RANGES = [7, 30, 90];

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function TierBadge({ tier }) {
  return (
    <span style={{
      background: (TIER_COLOR[tier] || '#64748b') + '26', color: TIER_COLOR[tier] || '#64748b',
      border: `1px solid ${TIER_COLOR[tier] || '#64748b'}`, padding: '2px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 700,
    }}>{tier}</span>
  );
}

function StatTile({ title, value, sub, tier }) {
  return (
    <div className="ui-surface" style={{ flex: '1 1 220px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        {tier && <TierBadge tier={tier} />}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function ReleaseMetricsPage() {
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState('production');
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [channelError, setChannelError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    api.channels().then(setChannels).catch((e) => setChannelError(e.message || 'Unable to load channels'));
  }, []);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setErr('');
    try {
      const result = await api.deploymentMetrics(channel, days);
      if (current === requestId.current) setMetrics(result);
    } catch (e) {
      if (current === requestId.current) setErr(e.message || 'Unable to load release metrics');
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [channel, days]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  const series = (metrics?.deployment_frequency.series || []).map((s) => ({
    day: new Date(s.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    count: s.count,
  }));

  return (
    <div>
      <PageHeader title={getPageContext("/release-metrics").title} description={getPageContext("/release-metrics").description} />
      {channelError && <FeedbackState kind="error" compact title="Channels unavailable" description={channelError} action={<button onClick={() => { setChannelError(''); api.channels().then(setChannels).catch((e) => setChannelError(e.message || 'Unable to load channels')); }}>Retry</button>} />}
      {err && <FeedbackState kind="error" title="Unable to load release metrics" description={err} action={<button onClick={load} disabled={loading}>Retry</button>} />}

      <FilterBar label="Release metric filters">
        <FormField label="Channel"><select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {channels.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}
        </select></FormField>
        <FormField label="Time range"><select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAY_RANGES.map((d) => <option key={d} value={d}>last {d} days</option>)}
        </select></FormField>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </FilterBar>

      {loading && <FeedbackState kind="loading" compact title={metrics ? 'Refreshing release metrics…' : 'Loading release metrics…'} />}
      {!loading && !err && !metrics && <FeedbackState kind="empty" title="No release metrics available" />}
      {!loading && !err && metrics && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatTile
              title="Deployment Frequency"
              value={`${metrics.deployment_frequency.per_week}/wk`}
              sub={`${metrics.deployment_frequency.count} succeeded deploy(s) in ${metrics.window_days}d`}
              tier={metrics.deployment_frequency.tier}
            />
            <StatTile
              title="Lead Time for Changes"
              value={fmtDuration(metrics.lead_time_for_changes.median_seconds)}
              sub="median, release creation → deploy"
              tier={metrics.lead_time_for_changes.tier}
            />
            <StatTile
              title="Change Failure Rate"
              value={metrics.change_failure_rate.percent != null ? `${metrics.change_failure_rate.percent}%` : '—'}
              sub={`${metrics.change_failure_rate.failed}/${metrics.change_failure_rate.total} deploy(s) failed or rolled back`}
              tier={metrics.change_failure_rate.tier}
            />
            <StatTile
              title="MTTR"
              value={fmtDuration(metrics.mttr.mean_seconds)}
              sub={`${metrics.mttr.recovered_count}/${metrics.mttr.incident_count} incident(s) recovered`}
              tier={metrics.mttr.tier}
            />
            <StatTile
              title="Mean Deployment Duration"
              value={fmtDuration(metrics.mean_deployment_duration.mean_seconds)}
              sub="pipeline wall-clock, start → finish"
            />
            <StatTile
              title="Rollback Frequency"
              value={metrics.rollback_frequency.percent != null ? `${metrics.rollback_frequency.percent}%` : '—'}
              sub={`${metrics.rollback_frequency.rolled_back}/${metrics.rollback_frequency.total} deploy(s) rolled back`}
            />
          </div>

          <div className="ui-surface">
            <h4>Deployments per day — {channels.find((c) => c.key === channel)?.name || channel}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} labelStyle={{ color: 'var(--text)' }} />
                <Bar dataKey="count" fill="#4f9dff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {series.length === 0 && <p className="empty">No succeeded deployments to this channel in the selected window.</p>}
          </div>

          <p className="hint" style={{ marginTop: 16 }}>
            DORA metrics computed from this channel&apos;s deployment history. Lead time is
            approximated as release-creation-to-deploy (not first-commit-to-deploy, which
            would need live per-repo GitHub calls). Tiers follow the published DORA bands
            (Elite/High/Medium/Low).
          </p>
        </>
      )}
    </div>
  );
}
