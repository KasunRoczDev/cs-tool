'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

// FPM event types we surface here.
const FPM_ALERT_TYPES = new Set([
  'fpm_max_children_reached', 'fpm_pool_saturated', 'fpm_listen_queue_backlog',
  'fpm_slow_requests', 'fpm_hot_worker', 'fpm_unreachable',
]);
const SEV = {
  critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399', info: '#60a5fa',
};

// Group slow requests by endpoint. The app is a front-controller (everything is
// /index.php?...), so the query keys ARE the route. We keep enum-like values
// (e.g. dataKey=order_details) but mask volatile ids (waybill_id=BE018077 → *)
// so the same logical endpoint aggregates together.
function normPath(p) {
  if (!p) return '—';
  const qi = p.indexOf('?');
  if (qi === -1) return p;
  const base = p.slice(0, qi);
  const parts = p.slice(qi + 1).split('&').map((kv) => {
    const eq = kv.indexOf('=');
    if (eq === -1) return kv;
    const k = kv.slice(0, eq), v = kv.slice(eq + 1);
    const volatile = /^\d+$/.test(v) || /^[A-Za-z]{1,4}\d{3,}$/.test(v) || v.length > 24;
    return k + '=' + (volatile ? '*' : v);
  });
  return base + '?' + parts.join('&');
}

function aggregateSlow(rows) {
  const g = {};
  for (const r of rows) {
    const raw = r.raw || {};
    const t = Number(raw.request_time);
    if (!isFinite(t)) continue;
    const key = (raw.method || 'GET') + ' ' + normPath(raw.path || '');
    (g[key] || (g[key] = [])).push(t);
  }
  const pct95 = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0;
  return Object.entries(g).map(([endpoint, ts]) => ({
    endpoint,
    count: ts.length,
    avg: ts.reduce((s, x) => s + x, 0) / ts.length,
    max: Math.max(...ts),
    p95: pct95(ts),
  })).sort((a, b) => b.avg * b.count - a.avg * a.count).slice(0, 12);
}

// Bottleneck ranking from the fpm_hot_worker events we ALREADY collect — each is
// a CPU-spike sample with the request that worker was running. No nginx/server
// config needed; works the moment hot-worker alerts exist.
function aggregateHot(rows) {
  const g = {};
  for (const r of rows) {
    const w = (r.raw && r.raw.worker) || {};
    const cpu = Number(w.cpu);
    if (!isFinite(cpu)) continue;
    const key = (w.method || 'GET') + ' ' + normPath(w.request_uri || w.script || '');
    const e = g[key] || (g[key] = { cpus: [], times: [] });
    e.cpus.push(cpu);
    if (isFinite(Number(w.duration_ms))) e.times.push(Number(w.duration_ms));
  }
  return Object.entries(g).map(([endpoint, e]) => ({
    endpoint,
    count: e.cpus.length,
    avgCpu: e.cpus.reduce((s, x) => s + x, 0) / e.cpus.length,
    maxCpu: Math.max(...e.cpus),
    avgTime: e.times.length ? e.times.reduce((s, x) => s + x, 0) / e.times.length : null,
  })).sort((a, b) => b.count * b.avgCpu - a.count * a.avgCpu).slice(0, 15);
}

function secs(n) { return n == null ? '—' : `${Math.round(n * 1000) / 1000}s`; }
function bytesMb(n) { return n == null ? '—' : `${Math.round((n / 1048576) * 10) / 10} MB`; }
function pct(n) { return n == null ? '—' : `${n}%`; }
function utilColor(u) { return u >= 100 ? '#f87171' : u >= 90 ? '#fb923c' : u >= 70 ? '#fbbf24' : '#34d399'; }

function Card({ children, style }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 16, ...style }}>{children}</div>
  );
}

function Bar({ value, color }) {
  return (
    <div style={{ height: 8, background: 'var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, value || 0)}%`, height: '100%', background: color }} />
    </div>
  );
}

function WorkerBox({ title, w, metricLabel, metricValue, accent }) {
  if (!w) return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--muted)' }}>No active worker</div>
    </div>
  );
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{metricValue}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{metricLabel}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
        <span style={{ color: accent, fontWeight: 700 }}>{w.method || 'GET'}</span> {w.request_uri || w.script || '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        pid {w.pid} · {bytesMb(w.memory)} · {pct(w.cpu)} cpu
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, marginTop: 4 }}>
        <span><span style={{ color: 'var(--muted)' }}>Wait </span>
          {w.wait_ms != null ? `${w.wait_ms} ms` : '—'}</span>
        <span><span style={{ color: 'var(--muted)' }}>Time </span>
          {w.duration_ms != null ? `${w.duration_ms} ms` : '—'}</span>
      </div>
    </div>
  );
}

function PoolCard({ pool }) {
  const u = pool.fpm_utilisation ?? 0;
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>🐘 Pool: {pool.fpm_pool}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {pool.fpm_active}/{pool.fpm_total} workers busy · {pool.fpm_idle} idle
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>Utilisation</span>
          <span style={{ fontWeight: 700, color: utilColor(u) }}>{u}%</span>
        </div>
        <Bar value={u} color={utilColor(u)} />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '14px 0', padding: '12px 0',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <WorkerBox title="🔥 Highest CPU — request at that time" w={pool.fpm_top_cpu}
          accent="#f87171" metricValue={pct(pool.fpm_top_cpu?.cpu)} metricLabel="CPU on last request" />
        <WorkerBox title="🧠 Highest memory — request at that time" w={pool.fpm_top_memory}
          accent="#a78bfa" metricValue={bytesMb(pool.fpm_top_memory?.memory)} metricLabel="memory on last request" />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
        <Stat label="Listen queue" value={pool.fpm_listen_queue} warn={pool.fpm_listen_queue > 0} />
        <Stat label="Max listen queue" value={pool.fpm_max_listen_queue} />
        <Stat label="max_children reached" value={pool.fpm_max_children_reached} warn={pool.fpm_max_children_reached > 0} />
        <Stat label="Max active" value={pool.fpm_max_active} />
        <Stat label="Slow requests" value={pool.fpm_slow_requests} warn={pool.fpm_slow_requests > 0} />
      </div>
    </Card>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: warn ? '#fb923c' : 'var(--fg)' }}>{value ?? '—'}</div>
    </div>
  );
}

function HotRequests({ rows }) {
  if (!rows || rows.length === 0) return null;
  const cpuColor = (c) => c >= 100 ? '#f87171' : c >= 90 ? '#fb923c' : '#fbbf24';
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🔥 CPU-heavy requests (bottlenecks)</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        Aggregated from FPM hot-worker samples, ranked by how often × how hard each endpoint burns CPU. IDs masked to group routes.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 70px 70px 80px', gap: 8,
        fontSize: 11, color: 'var(--muted)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
        <div>Endpoint</div><div style={{ textAlign: 'right' }}>Hits</div>
        <div style={{ textAlign: 'right' }}>Avg CPU</div><div style={{ textAlign: 'right' }}>Max CPU</div>
        <div style={{ textAlign: 'right' }}>Avg time</div>
      </div>
      {rows.map((r) => (
        <div key={r.endpoint} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 70px 70px 80px',
          gap: 8, fontSize: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.endpoint}</div>
          <div style={{ textAlign: 'right' }}>{r.count}</div>
          <div style={{ textAlign: 'right', fontWeight: 700, color: cpuColor(r.avgCpu) }}>{Math.round(r.avgCpu)}%</div>
          <div style={{ textAlign: 'right', color: cpuColor(r.maxCpu) }}>{Math.round(r.maxCpu)}%</div>
          <div style={{ textAlign: 'right' }}>{r.avgTime == null ? '—' : `${Math.round(r.avgTime)} ms`}</div>
        </div>
      ))}
    </Card>
  );
}

const EXT_FIELDS = [
  ['swap', 'Swap %', (v) => `${v}%`], ['inode', 'Inode %', (v) => `${v}%`],
  ['conntrack', 'conntrack %', (v) => v == null ? 'n/a' : `${v}%`],
  ['fd_usage', 'File descriptors %', (v) => `${v}%`],
  ['tcp_established', 'TCP established', (v) => v], ['tcp_time_wait', 'TCP TIME_WAIT', (v) => v],
  ['tcp_syn_recv', 'TCP SYN_RECV', (v) => v], ['proc_zombie', 'Zombie procs', (v) => v],
  ['load_per_core', 'Load / core', (v) => v], ['disk_io_queue', 'Disk I/O queue', (v) => v],
  ['time_drift_ms', 'Time drift (ms)', (v) => v == null ? 'n/a' : v],
];

function ExtendedHost({ ext }) {
  if (!ext) return null;
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>⚙️ Host (extended metrics)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
        {EXT_FIELDS.map(([k, label, fmt]) => (
          <div key={k}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{ext[k] == null ? '—' : fmt(ext[k])}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SlowEndpoints({ rows }) {
  if (!rows || rows.length === 0) return null;
  const sevColor = (s) => s >= 5 ? '#f87171' : s >= 2 ? '#fb923c' : '#fbbf24';
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🐌 Slowest endpoints (bottlenecks)</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        Aggregated from nginx request time, ranked by total time impact. IDs masked to group routes.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 70px 70px', gap: 8,
        fontSize: 11, color: 'var(--muted)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
        <div>Endpoint</div><div style={{ textAlign: 'right' }}>Count</div>
        <div style={{ textAlign: 'right' }}>Avg</div><div style={{ textAlign: 'right' }}>p95</div>
        <div style={{ textAlign: 'right' }}>Max</div>
      </div>
      {rows.map((r) => (
        <div key={r.endpoint} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 70px 70px',
          gap: 8, fontSize: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.endpoint}</div>
          <div style={{ textAlign: 'right' }}>{r.count}</div>
          <div style={{ textAlign: 'right', fontWeight: 700, color: sevColor(r.avg) }}>{secs(r.avg)}</div>
          <div style={{ textAlign: 'right', color: sevColor(r.p95) }}>{secs(r.p95)}</div>
          <div style={{ textAlign: 'right', color: sevColor(r.max) }}>{secs(r.max)}</div>
        </div>
      ))}
    </Card>
  );
}

export default function FpmPage() {
  const [servers, setServers] = useState([]);
  const [serverId, setServerId] = useState('');
  const [pools, setPools] = useState([]);
  const [ext, setExt] = useState(null);
  const [slow, setSlow] = useState([]);
  const [hot, setHot] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.servers().then((s) => {
      setServers(s);
      if (s.length) setServerId((prev) => prev || s[0].id);
    }).catch((e) => setErr(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const rows = await api.securityEvents(serverId); // SELECT * → includes raw
      // Latest snapshot per pool.
      const latestByPool = {};
      let latestExt = null;
      const al = [];
      const slowRows = [];
      const hotRows = [];
      for (const r of rows) {
        if (r.event_type === 'fpm_pool_snapshot' && r.raw) {
          const name = r.raw.fpm_pool || 'www';
          if (!latestByPool[name]) latestByPool[name] = r.raw;
        } else if (r.event_type === 'system_extended_snapshot' && r.raw) {
          if (!latestExt) latestExt = r.raw;
        } else if (r.event_type === 'nginx_slow_request' && r.raw) {
          slowRows.push(r);
        } else if (r.event_type === 'fpm_hot_worker' && r.raw) {
          hotRows.push(r);
          if (al.length < 30) al.push(r);
        } else if (FPM_ALERT_TYPES.has(r.event_type)) {
          if (al.length < 30) al.push(r);
        }
      }
      setPools(Object.values(latestByPool));
      setExt(latestExt);
      setSlow(aggregateSlow(slowRows));
      setHot(aggregateHot(hotRows));
      setAlerts(al);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>🐘 PHP-FPM & System</h1>
        <select value={serverId} onChange={(e) => setServerId(e.target.value)}
          style={{ background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 12px' }}>
          {servers.length === 0 && <option value="">No servers</option>}
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {err && <Card style={{ borderColor: '#f87171', color: '#f87171', marginBottom: 14 }}>{err}</Card>}

      {!loading && pools.length === 0 && !ext && (
        <Card style={{ color: 'var(--muted)' }}>
          No FPM or extended-metric data yet for this server. Enable the <code>fpm:</code> block in the
          agent config and wire <code>collectFpmAsEvents</code> / <code>collectExtendedAsEvent</code> in
          the agent (see monitoring/README.md). Data appears here within a minute of the agent sending it.
        </Card>
      )}

      {pools.map((p) => <PoolCard key={p.fpm_pool} pool={p} />)}
      <HotRequests rows={hot} />
      <SlowEndpoints rows={slow} />
      <ExtendedHost ext={ext} />

      {alerts.length > 0 && (
        <Card>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Recent FPM alerts</div>
          {alerts.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0',
              borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: SEV[a.severity] || '#888', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 130 }}>
                {new Date(a.time).toLocaleString()}
              </span>
              <span style={{ fontSize: 13 }}>{a.message}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
