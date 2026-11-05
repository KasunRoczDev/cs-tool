'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import MetricCard from '@/components/ui/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import FilterBar from '@/components/ui/FilterBar';
import FormField from '@/components/ui/FormField';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

// One descriptor per metric. status is computed from `statusKey` (defaults to key);
// invert=true means a LOWER value is worse (cert runway, success rate).
const METRICS = [
  { key: 'load_avg_1',          label: 'Load Average',                unit: '',     statusKey: 'load_per_core', warn: 1,    crit: 2,
    sub: (r) => r.load_per_core != null ? `${r.load_per_core}× per core` : null },
  { key: 'api_p95_ms',          label: 'API Response Time P95',       unit: 'ms',   warn: 1000, crit: 3000, dp: 0 },
  { key: 'api_error_rate',      label: 'API Error Rate',              unit: '%',    warn: 1,    crit: 5,    dp: 2 },
  { key: 'pg_connections',      label: 'PostgreSQL Connections',      unit: '',     statusKey: 'pg_connections_pct', warn: 80, crit: 95,
    sub: (r) => r.pg_connections_pct != null ? `${r.pg_connections_pct}% of max` : null },
  { key: 'pg_slow_queries',     label: 'Slow Queries',                unit: '',     warn: 1,    crit: 10 },
  { key: 'redis_memory_mb',     label: 'Redis Memory Usage',          unit: 'MB',   statusKey: 'redis_memory_pct', warn: 80, crit: 95, dp: 1,
    sub: (r) => r.redis_memory_pct != null ? `${r.redis_memory_pct}%` : null },
  { key: 'bullmq_pending',      label: 'BullMQ Pending Jobs',         unit: '',     warn: 1000, crit: 10000 },
  { key: 'bullmq_failed',       label: 'BullMQ Failed Jobs',          unit: '',     warn: 1,    crit: 50 },
  { key: 'docker_restart_count',label: 'Docker Restart Count',        unit: '',     warn: 3,    crit: 10 },
  { key: 'ssl_expiry_days',     label: 'SSL Expiry Days',             unit: 'd',    warn: 14,   crit: 7,  invert: true,
    sub: (r) => r.ssl_expiry_target ? String(r.ssl_expiry_target) : null },
  { key: 'failed_ssh_attempts', label: 'Failed SSH Attempts',         unit: '',     warn: 10,   crit: 50 },
  { key: 'order_success_rate',  label: 'Order Processing Success Rate',unit: '%',   warn: 99,   crit: 95, invert: true, dp: 1 },
];

const COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)', none: 'var(--muted)' };

function statusOf(m, raw) {
  const v = raw?.[m.statusKey || m.key];
  if (v == null || !isFinite(v)) return 'none';
  if (m.invert) return v <= m.crit ? 'crit' : v <= m.warn ? 'warn' : 'ok';
  return v >= m.crit ? 'crit' : v >= m.warn ? 'warn' : 'ok';
}

function fmt(m, raw) {
  const v = raw?.[m.key];
  if (v == null || !isFinite(v)) return '—';
  const dp = m.dp ?? (Number.isInteger(v) ? 0 : 2);
  const num = v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return m.unit ? `${num} ${m.unit}` : num;
}

// Tiny inline sparkline from the snapshot history (chronological).
function Spark({ values, color }) {
  const pts = values.filter((v) => v != null && isFinite(v));
  if (pts.length < 2) return <div style={{ height: 28 }} />;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const W = 200, H = 28;
  const d = pts.map((v, i) =>
    `${(i / (pts.length - 1)) * W},${H - ((v - min) / span) * (H - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 28, marginTop: 8 }}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function ServiceMetricsPage() {
  const [servers, setServers] = useState([]);
  const [serverId, setServerId] = useState('');
  const [rows, setRows] = useState([]);       // snapshot events, newest first
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [serversLoading, setServersLoading] = useState(true);
  const [serversError, setServersError] = useState('');
  const [loadedServerId, setLoadedServerId] = useState('');
  const requestId = useRef(0);

  const loadServers = () => {
    setServersLoading(true); setServersError('');
    api.servers()
      .then((s) => { setServers(s); if (s.length && !serverId) setServerId(s[0].id); })
      .catch((e) => setServersError(e.message || 'Unable to load servers')).finally(() => setServersLoading(false));
  };
  useEffect(() => { loadServers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!serverId) return;
    const currentRequest = ++requestId.current;
    setLoading(true); setErr('');
    return api.securityEvents(serverId, 'service_metrics_snapshot')
      .then((r) => {
        if (currentRequest !== requestId.current) return;
        setRows(Array.isArray(r) ? r : []); setLoadedServerId(serverId);
      })
      .catch((e) => { if (currentRequest === requestId.current) setErr(e.message); })
      .finally(() => { if (currentRequest === requestId.current) setLoading(false); });
  }, [serverId]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  const latest = rows[0]?.raw || null;
  const history = useMemo(() => rows.slice().reverse(), [rows]); // chronological
  const breaches = latest ? METRICS.filter((m) => statusOf(m, latest) === 'crit' || statusOf(m, latest) === 'warn').length : 0;

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/service-metrics')} wide />
      <FilterBar label="Server selection"><FormField label="Server">
        <select value={serverId} onChange={(e) => { requestId.current += 1; setServerId(e.target.value); setErr(''); }}>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FormField><button onClick={load} disabled={loading || !serverId}>{loading ? 'Refreshing…' : 'Refresh'}</button></FilterBar>
      {serversLoading && <FeedbackState kind="loading" title="Loading servers…" />}
      {serversError && <FeedbackState kind="error" description={serversError} action={<button onClick={loadServers}>Retry</button>} />}
      {!serversLoading && !serversError && servers.length === 0 && <FeedbackState title="No servers available" description="Add a server from Overview to collect telemetry." />}
      {(loading || (serverId && loadedServerId !== serverId && !err)) && <FeedbackState kind="loading" title="Loading snapshots…" />}
      {err && <FeedbackState kind="error" description={err} action={<button onClick={load} disabled={loading}>Retry</button>} />}
      <div aria-busy={loading || serversLoading}>

      {loadedServerId === serverId && serverId && !err && !loading && (!latest ? (
        <FeedbackState title="No service snapshots yet" description={<>No <code>service_metrics_snapshot</code> received for this server yet. Enable{' '}
          <code>service_metrics</code> in the agent config (see <code>agent.example.yaml</code>) — the
          agent ships these on the snapshot interval.</>} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span className={breaches ? 'pill sev-high' : 'pill sev-low'}>
              {breaches ? `${breaches} metric${breaches > 1 ? 's' : ''} need attention` : 'All metrics healthy'}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              last snapshot {new Date(rows[0].time).toLocaleString()} · {rows.length} samples
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))', gap: 14 }}>
            {METRICS.map((m) => {
              const st = statusOf(m, latest);
              const color = COLOR[st];
              const series = history.map((r) => r.raw?.[m.key]);
              return (
                <MetricCard key={m.key} label={m.label} value={fmt(m, latest)}
                  tone={st === 'crit' ? 'critical' : st === 'warn' ? 'warning' : 'neutral'}
                  detail={<><StatusBadge status={st === 'crit' ? 'critical' : st === 'warn' ? 'warning' : st === 'ok' ? 'healthy' : 'not reported'} /><div>{m.sub?.(latest) || (st === 'none' ? 'Not reported' : `warn ${m.invert ? '≤' : '≥'}${m.warn} · crit ${m.invert ? '≤' : '≥'}${m.crit}`)}</div></>}
                  trend={<Spark values={series} color={color === COLOR.none ? 'var(--border)' : color} />} />
              );
            })}
          </div>

          <p className="hint" style={{ marginTop: 16 }}>
            Thresholds shown are the agent defaults; breaches are promoted to alerts by the backend alert
            engine (override via <code>ALERT_*</code> env vars). Blank metrics simply aren&apos;t configured
            in the agent yet.
          </p>
        </>
      ))}
      </div>
    </div>
  );
}
