'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar,
} from 'recharts';
import { api } from '@/lib/api';

const RANGES = [
  { label: '1h', ms: 3600e3 },
  { label: '6h', ms: 6 * 3600e3 },
  { label: '24h', ms: 24 * 3600e3 },
  { label: '7d', ms: 7 * 24 * 3600e3 },
];

const METRICS = [
  { key: 'cpu_usage',    label: 'CPU %',      color: '#4f9dff', unit: '%' },
  { key: 'memory_usage', label: 'Memory %',   color: '#34d399', unit: '%' },
  { key: 'disk_usage',   label: 'Disk %',     color: '#fbbf24', unit: '%' },
  { key: 'net_in',       label: 'Net In B/s', color: '#a78bfa', unit: '' },
];

const COLORS = ['#4f9dff','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#60a5fa','#f472b6'];

const ENV_COLORS = { live: '#34d399', staging: '#fbbf24', dev: '#60a5fa', test: '#a78bfa' };

function EnvTag({ env }) {
  if (!env) return <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>;
  const color = ENV_COLORS[env] || '#888';
  return (
    <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
      background: color + '22', color, border: `1px solid ${color}55`, textTransform: 'uppercase' }}>{env}</span>
  );
}

function StatCard({ label, value, unit = '%', color }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 18px' }}>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: color || 'var(--fg)' }}>{value}{unit}</div>
    </div>
  );
}

export default function PerformancePage() {
  const [servers, setServers] = useState([]);
  const [overview, setOverview] = useState([]);
  const [rangeMs, setRangeMs] = useState(3600e3);
  const [metric, setMetric] = useState('cpu_usage');
  const [envFilter, setEnvFilter] = useState('');
  const [seriesMap, setSeriesMap] = useState({}); // serverId → [{t, value}]
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const metaDef = METRICS.find((m) => m.key === metric) || METRICS[0];

  useEffect(() => {
    Promise.all([api.servers(), api.overview()]).then(([srvs, ov]) => {
      setServers(srvs);
      setOverview(ov);
      setSelectedIds(new Set(srvs.map((s) => s.id)));
    }).catch(() => {});
  }, []);

  const filteredServers = servers.filter((s) => {
    if (envFilter && s.tags?.env !== envFilter) return false;
    return true;
  });

  const loadMetrics = useCallback(async () => {
    if (filteredServers.length === 0) return;
    setLoading(true);
    const from = new Date(Date.now() - rangeMs).toISOString();
    const results = await Promise.allSettled(
      filteredServers.map((s) => api.metrics(s.id, from).then((rows) => ({ id: s.id, rows }))),
    );
    const map = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { id, rows } = r.value;
        map[id] = rows.map((pt) => ({
          t: new Date(pt.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          value: pt[metric] ?? null,
        }));
      }
    }
    setSeriesMap(map);
    setLoading(false);
  }, [filteredServers.map((s) => s.id).join(','), rangeMs, metric]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // Build combined chart data: merged timeline across all selected servers
  const allTimes = [...new Set(
    Object.values(seriesMap).flatMap((pts) => pts.map((p) => p.t))
  )].sort();

  const chartData = allTimes.map((t) => {
    const row = { t };
    for (const srv of filteredServers) {
      if (!selectedIds.has(srv.id)) continue;
      const pt = (seriesMap[srv.id] || []).find((p) => p.t === t);
      row[srv.id] = pt?.value ?? null;
    }
    return row;
  });

  // Current snapshot from overview
  const overviewMap = Object.fromEntries(overview.map((o) => [o.id, o]));

  // Top offenders
  const sorted = [...filteredServers]
    .map((s) => ({ ...s, val: overviewMap[s.id]?.[metric] ?? 0 }))
    .sort((a, b) => b.val - a.val);

  const avgVal = filteredServers.length
    ? (filteredServers.reduce((sum, s) => sum + (overviewMap[s.id]?.[metric] || 0), 0) / filteredServers.length).toFixed(1)
    : '0';
  const maxServer = sorted[0];
  const onlineCount = filteredServers.filter((s) => overviewMap[s.id]?.status === 'online').length;

  const toggleServer = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const envOptions = [...new Set(servers.map((s) => s.tags?.env).filter(Boolean))];

  return (
    <div>
      <div className="page-head">
        <h2>Performance Dashboard</h2>
        <span className="muted">{loading ? 'Loading…' : `${filteredServers.length} servers`}</span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <div className="filter-field">
          <label>Metric</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Time range</label>
          <select value={rangeMs} onChange={(e) => setRangeMs(Number(e.target.value))}>
            {RANGES.map((r) => <option key={r.label} value={r.ms}>Last {r.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Environment</label>
          <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)}>
            <option value="">All envs</option>
            {envOptions.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <button onClick={loadMetrics} style={{ padding: '6px 14px', borderRadius: '6px',
          background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label={`Avg ${metaDef.label}`} value={avgVal} color={metaDef.color} />
        <StatCard label="Servers online" value={onlineCount} unit={`/${filteredServers.length}`} color="var(--ok)" />
        {maxServer && <StatCard label={`Highest ${metaDef.label}`} value={(maxServer.val ?? 0).toFixed(1)} unit={metaDef.unit} color="var(--crit)" />}
      </div>

      {/* Multi-server trend chart */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0 }}>{metaDef.label} — All servers</h4>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {filteredServers.map((s, i) => (
              <button key={s.id} onClick={() => toggleServer(s.id)}
                style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer',
                  background: selectedIds.has(s.id) ? COLORS[i % COLORS.length] + '33' : 'transparent',
                  border: `1px solid ${COLORS[i % COLORS.length]}`,
                  color: COLORS[i % COLORS.length], opacity: selectedIds.has(s.id) ? 1 : 0.4 }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
            <YAxis domain={[0, metric.includes('net') ? 'auto' : 100]}
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickFormatter={(v) => `${v}${metaDef.unit}`} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', fontSize: 12 }} />
            <Legend />
            {filteredServers.map((s, i) => selectedIds.has(s.id) && (
              <Line key={s.id} type="monotone" dataKey={s.id} name={s.name}
                stroke={COLORS[i % COLORS.length]} dot={false} isAnimationActive={false}
                strokeWidth={1.5} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-server snapshot table */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {sorted.map((s, i) => {
          const ov = overviewMap[s.id] || {};
          return (
            <div key={s.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{s.name}</div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <EnvTag env={s.tags?.env} />
                    <span className={`dot ${ov.status || 'unknown'}`} style={{ display: 'inline-block' }} />
                  </div>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: COLORS[i % COLORS.length] }}>
                  {(ov[metric] ?? 0).toFixed(0)}{metaDef.unit}
                </div>
              </div>
              {/* Mini bars */}
              {[
                { label: 'CPU', key: 'cpu_usage', color: '#4f9dff' },
                { label: 'Mem', key: 'memory_usage', color: '#34d399' },
                { label: 'Disk', key: 'disk_usage', color: '#fbbf24' },
              ].map((bar) => {
                const val = ov[bar.key] ?? 0;
                return (
                  <div key={bar.key} style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' }}>
                      <span>{bar.label}</span><span>{val.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: '4px', background: 'var(--panel-2)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, val)}%`, background: bar.color, borderRadius: '2px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Top servers bar chart */}
      <div className="card">
        <h4 style={{ marginBottom: '12px' }}>Top servers by {metaDef.label}</h4>
        <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 36)}>
          <BarChart data={sorted.map((s) => ({ name: s.name, value: s.val ?? 0 }))} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, metric.includes('net') ? 'auto' : 100]}
              tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', fontSize: 12 }} />
            <Bar dataKey="value" name={metaDef.label} fill={metaDef.color} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
