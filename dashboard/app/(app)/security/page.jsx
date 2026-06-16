'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { api } from '@/lib/api';

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.servers().then(setServers).catch(() => {});
    api.secTypes().then(setTypes).catch(() => {});
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
    setLoading(true);
    Promise.all([
      api.secStats(apiFilters),
      api.secGrouped({ ...apiFilters, limit: 100 }),
      api.secEvents({ ...apiFilters, limit: 300 }),
    ]).then(([s, g, e]) => { setStats(s); setGrouped(g); setEvents(e); })
      .catch(() => {})
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

  const tsData = (stats?.timeseries || []).map((r) => ({ t: fmtShort(r.bucket), low: r.low, medium: r.medium, high: r.high, critical: r.critical }));
  const typeData = (stats?.byType || []).map((r) => ({ name: r.event_type, count: r.c }));
  const ipData = (stats?.topIps || []).map((r) => ({ name: r.source_ip, count: r.c }));
  const sevData = (stats?.bySeverity || []).map((r) => ({ name: r.severity, value: r.c }));

  return (
    <div>
      <div className="page-head">
        <h2>Security Events</h2>
        <span className="muted">{loading ? 'Loading…' : `${stats?.total ?? 0} events`}</span>
      </div>

      {/* FILTER BAR */}
      <div className="filter-bar">
        <div className="filter-field">
          <label>Server</label>
          <select value={filters.serverId} onChange={(e) => set('serverId', e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Event type</label>
          <select value={filters.type} onChange={(e) => set('type', e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Severity</label>
          <select value={filters.severity} onChange={(e) => set('severity', e.target.value)}>
            <option value="">All</option>
            {SEVS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Source IP</label>
          <input placeholder="e.g. 1.2.3" value={filters.sourceIp} onChange={(e) => set('sourceIp', e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Time range</label>
          <select value={filters.rangeMs} onChange={(e) => set('rangeMs', Number(e.target.value))}>
            {RANGES.map((r) => <option key={r.label} value={r.ms}>{r.label}</option>)}
          </select>
        </div>
        <button className="reset-btn" onClick={reset}>Reset</button>
      </div>

      {/* SUMMARY CARDS */}
      <div className="metrics-grid">
        <div className="metric-card"><h3>Total events</h3><div className="value">{stats?.total ?? 0}</div></div>
        <div className="metric-card"><h3>Failed logins</h3><div className="value" style={{ color: 'var(--warn)' }}>{failedLogins}</div></div>
        <div className="metric-card"><h3>High / Critical</h3><div className="value" style={{ color: 'var(--crit)' }}>{critHigh}</div></div>
        <div className="metric-card"><h3>Top source IPs</h3><div className="value">{uniqueIps}</div></div>
        <div className="metric-card"><h3>Servers affected</h3><div className="value">{serversAffected}</div></div>
      </div>

      {/* CHARTS */}
      <div className="chart-grid">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h4>Events over time (by severity)</h4>
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
          <h4>Events by type</h4>
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
          <h4>Top source IPs</h4>
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
          <h4>Severity breakdown</h4>
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
          <h4>Events by server</h4>
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
      <h3>Top occurrences</h3>
      <table className="grid">
        <thead>
          <tr><th>Severity</th><th>Type</th><th>Server</th><th>Source IP</th><th>Times</th><th>First seen</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {grouped.map((g, i) => (
            <tr key={i}>
              <td><span className={`pill sev-${g.severity}`}>{g.severity}</span></td>
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
      </table>

      {/* DETAILED EVENTS */}
      <h3 style={{ marginTop: 28 }}>Event log ({events.length})</h3>
      <table className="grid">
        <thead>
          <tr><th>Time</th><th>Severity</th><th>Type</th><th>Server</th><th>Source IP</th><th>User</th><th>Message</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted">{fmt(e.time)}</td>
              <td><span className={`pill sev-${e.severity}`}>{e.severity}</span></td>
              <td>{e.event_type}</td>
              <td>{e.server_name || '—'}</td>
              <td className="mono">{e.source_ip || '—'}</td>
              <td>{e.username || '—'}</td>
              <td>{e.message}</td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan="7" className="empty">No matching events.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
