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
        pid {w.pid} · {w.duration_ms != null ? `${w.duration_ms} ms` : '—'} · {bytesMb(w.memory)} · {pct(w.cpu)} cpu
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

export default function FpmPage() {
  const [servers, setServers] = useState([]);
  const [serverId, setServerId] = useState('');
  const [pools, setPools] = useState([]);
  const [ext, setExt] = useState(null);
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
      for (const r of rows) {
        if (r.event_type === 'fpm_pool_snapshot' && r.raw) {
          const name = r.raw.fpm_pool || 'www';
          if (!latestByPool[name]) latestByPool[name] = r.raw;
        } else if (r.event_type === 'system_extended_snapshot' && r.raw) {
          if (!latestExt) latestExt = r.raw;
        } else if (FPM_ALERT_TYPES.has(r.event_type)) {
          if (al.length < 30) al.push(r);
        }
      }
      setPools(Object.values(latestByPool));
      setExt(latestExt);
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
