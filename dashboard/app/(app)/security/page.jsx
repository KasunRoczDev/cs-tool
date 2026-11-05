'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import MetricCard from '@/components/ui/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import FilterBar from '@/components/ui/FilterBar';
import FormField from '@/components/ui/FormField';
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';
import PaginatedEventList from '@/components/PaginatedEventList';

const RANGES = [
  { label: 'Last 1h', ms: 3600e3 },
  { label: 'Last 6h', ms: 6 * 3600e3 },
  { label: 'Last 24h', ms: 24 * 3600e3 },
  { label: 'Last 7d', ms: 7 * 24 * 3600e3 },
  { label: 'Last 30d', ms: 30 * 24 * 3600e3 },
];
const SEV_COLORS = { low: '#34d399', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const SEVS = ['low', 'medium', 'high', 'critical'];
const fmt = (iso) => new Date(iso).toLocaleString();
const fmtShort = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function SecurityPage() {
  const [servers, setServers] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ serverId: '', type: '', severity: '', sourceIp: '', rangeMs: 24 * 3600e3 });
  const [stats, setStats] = useState(null);
  const [grouped, setGrouped] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');

  useEffect(() => {
    api.servers().then(setServers).catch((e) => setFilterError(e.message || 'Unable to load server filters'));
    api.secTypes().then(setTypes).catch((e) => setFilterError(e.message || 'Unable to load event types'));
    // Deep-link support: /security?serverId=...&type=...
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const sid = sp.get('serverId'); const ty = sp.get('type');
      if (sid || ty) setFilters((f) => ({ ...f, serverId: sid || f.serverId, type: ty || f.type }));
    }
  }, []);

  const apiFilters = useMemo(() => ({
    serverId: filters.serverId,
    type: filters.type,
    severity: filters.severity,
    sourceIp: filters.sourceIp,
    from: new Date(Date.now() - filters.rangeMs).toISOString(),
  }), [filters]);

  const load = () => {
    setLoading(true); setError('');
    Promise.all([
      api.secStats(apiFilters),
      api.secGrouped({ ...apiFilters, limit: 100 }),
      api.secEvents({ ...apiFilters, limit: 300 }),
    ]).then(([s, g, e]) => { setStats(s); setGrouped(g); setEvents(e); })
      .catch((e) => setError(e.message || 'Unable to load security events'))
      .finally(() => setLoading(false));
  };

  // refetch whenever filters change
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [apiFilters]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const reset = () => setFilters({ serverId: '', type: '', severity: '', sourceIp: '', rangeMs: 24 * 3600e3 });

  // derived summary numbers
  const failedLogins = stats?.byType?.find((t) => t.event_type === 'ssh_failed_login')?.c || 0;
  const critHigh = (stats?.bySeverity || []).filter((s) => s.severity === 'high' || s.severity === 'critical').reduce((a, b) => a + b.c, 0);
  const uniqueIps = stats?.topIps?.length || 0;
  const serversAffected = (stats?.byServer || []).filter((s) => s.c > 0).length;

  // Lynis host-hardening: latest hardening index (from the newest lynis_audit
  // event) + warning/suggestion counts (from type stats).
  const lynisAudit = events.find((e) => e.event_type === 'lynis_audit');
  const hardeningIndex = lynisAudit
    ? (lynisAudit.raw?.hardening_index ?? Number((String(lynisAudit.message).match(/index\s+(\d+)/) || [])[1]))
    : null;
  const lynisWarnings = stats?.byType?.find((t) => t.event_type === 'lynis_warning')?.c || 0;
  const lynisSuggestions = stats?.byType?.find((t) => t.event_type === 'lynis_suggestion')?.c || 0;
  const hardColor = hardeningIndex == null ? 'var(--muted)'
    : hardeningIndex >= 75 ? '#34d399' : hardeningIndex >= 50 ? '#fbbf24' : '#f87171';

  const tsData = (stats?.timeseries || []).map((r) => ({ t: fmtShort(r.bucket), low: r.low, medium: r.medium, high: r.high, critical: r.critical }));
  const typeData = (stats?.byType || []).map((r) => ({ name: r.event_type, count: r.c }));
  const ipData = (stats?.topIps || []).map((r) => ({ name: r.source_ip, count: r.c }));
  const sevData = (stats?.bySeverity || []).map((r) => ({ name: r.severity, value: r.c }));

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/security')} wide />
      {loading && <FeedbackState kind="loading" title="Loading security events…" />}
      {error && <FeedbackState kind="error" description={error} action={<button onClick={load} disabled={loading}>Retry</button>} />}
      {filterError && <FeedbackState kind="error" title="Some filters are unavailable" description={filterError} />}
      {/* FILTER BAR */}
      <FilterBar label="Security filters">
        <FormField label="Server"><select value={filters.serverId} onChange={(e) => set('serverId', e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></FormField>
        <FormField label="Event type"><select value={filters.type} onChange={(e) => set('type', e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></FormField>
        <FormField label="Severity"><select value={filters.severity} onChange={(e) => set('severity', e.target.value)}>
            <option value="">All</option>
            {SEVS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></FormField>
        <FormField label="Source IP"><input placeholder="e.g. 1.2.3" value={filters.sourceIp} onChange={(e) => set('sourceIp', e.target.value)} /></FormField>
        <FormField label="Time range"><select value={filters.rangeMs} onChange={(e) => set('rangeMs', Number(e.target.value))}>
            {RANGES.map((r) => <option key={r.label} value={r.ms}>{r.label}</option>)}
          </select></FormField>
        <button className="reset-btn" onClick={reset}>Reset</button>
      </FilterBar>
      <div aria-busy={loading}>
      {!loading && !error && <>

      {/* SUMMARY CARDS */}
      <div className="metrics-grid">
        <MetricCard label="Total events" value={stats?.total ?? 0} />
        <MetricCard label="Failed logins" value={failedLogins} tone="warning" />
        <MetricCard label="High / critical" value={critHigh} tone="critical" />
        <MetricCard label="Top source IPs" value={uniqueIps} />
        <MetricCard label="Servers affected" value={serversAffected} />
        {(hardeningIndex != null || lynisWarnings > 0 || lynisSuggestions > 0) && <MetricCard label="Lynis hardening" value={hardeningIndex == null ? null : `${hardeningIndex}/100`} detail={`${lynisWarnings} warnings · ${lynisSuggestions} suggestions`} />}
      </div>

      {/* CHARTS */}
      <div className="chart-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <SectionHeader title="Events over time (by severity)" />
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={tsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Legend />
              {SEVS.map((s) => (
                <Area key={s} type="monotone" dataKey={s} stackId="1" stroke={SEV_COLORS[s]} fill={SEV_COLORS[s]} fillOpacity={0.5} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <SectionHeader title="Events by type" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={typeData} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Bar dataKey="count" fill="#4f9dff" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <SectionHeader title="Top source IPs" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ipData} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Bar dataKey="count" fill="#f87171" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <SectionHeader title="Severity breakdown" />
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={sevData} dataKey="value" nameKey="name" outerRadius={90} label>
                {sevData.map((d) => <Cell key={d.name} fill={SEV_COLORS[d.name] || '#888'} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <SectionHeader title="Events by server" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={(stats?.byServer || []).map((r) => ({ name: r.server_name || 'unknown', count: r.c }))} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Bar dataKey="count" fill="#a78bfa" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* GROUPED OCCURRENCES — "how many times" */}
      <SectionHeader title="Top occurrences" />
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <div role="region" aria-label="Security occurrences" tabIndex={0} className="focus-ring" style={{ maxWidth: '100%', overflowX: 'auto' }}><table className="grid" style={{ margin: 0, borderRadius: 0 }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--panel-2)', zIndex: 10 }}>
              <tr><th scope="col">Severity</th><th scope="col">Type</th><th scope="col">Server</th><th scope="col">Source IP</th><th scope="col">Times</th><th scope="col">First seen</th><th scope="col">Last seen</th></tr>
            </thead>
            <tbody>
              {grouped.map((g, i) => (
                <tr key={i}>
                  <td><StatusBadge status={g.severity === 'high' || g.severity === 'medium' ? 'warning' : g.severity}>{g.severity}</StatusBadge></td>
                  <td>{g.event_type}</td>
                  <td>{g.server_name || '—'}</td>
                  <td className="mono">{g.source_ip || '—'}</td>
                  <td><b>{g.occurrences}</b></td>
                  <td className="muted">{fmtShort(g.first_seen)}</td>
                  <td className="muted">{fmtShort(g.last_seen)}</td>
                </tr>
              ))}
              {grouped.length === 0 && <tr><td colSpan="7" className="empty">No matching events.</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* DETAILED EVENTS — Using Paginated List */}
      <SectionHeader title="Event log" />
      <PaginatedEventList
        events={events.map((e) => ({
          id: e.id,
          timestamp: e.time,
          type: e.event_type,
          severity: e.severity,
          message: e.message,
          source: e.server_name,
          source_ip: e.source_ip,
          username: e.username,
        }))}
        loading={loading}
        title={`Event log (${events.length})`}
        itemsPerPage={20}
      />
      </>}
      </div>
    </div>
  );
}
