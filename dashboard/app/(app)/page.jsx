'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import RegisterServer from '@/components/RegisterServer';

const ENV_OPTIONS = ['live', 'staging', 'dev', 'test'];
const ENV_COLORS = { live: '#34d399', staging: '#fbbf24', dev: '#60a5fa', test: '#a78bfa' };

function EnvTag({ env }) {
  if (!env) return null;
  const color = ENV_COLORS[env] || '#888';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
      fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
      background: color + '22', color, border: `1px solid ${color}66`,
    }}>{env}</span>
  );
}

function EnvEditor({ serverId, currentEnv, onSaved }) {
  const [val, setVal] = useState(currentEnv || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateServer(serverId, { tags: { env: val } });
      onSaved(val);
    } catch {}
    setSaving(false);
  };

  return (
    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
      <select value={val} onChange={(e) => setVal(e.target.value)}
        style={{ fontSize: '11px', padding: '2px 4px', borderRadius: '4px',
          background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}>
        <option value="">— none —</option>
        {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <button onClick={save} disabled={saving}
        style={{ fontSize: '10px', padding: '2px 6px', cursor: 'pointer', borderRadius: '4px',
          background: 'var(--accent)', color: '#fff', border: 'none' }}>
        {saving ? '…' : '✓'}
      </button>
    </span>
  );
}

function bar(value) {
  const v = value ?? 0;
  const cls = v >= 90 ? 'crit' : v >= 75 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className={`meter-fill ${cls}`} style={{ width: `${Math.min(100, v)}%` }} />
      <span>{value == null ? '—' : `${v.toFixed(0)}%`}</span>
    </div>
  );
}

export default function OverviewPage() {
  const [rows, setRows] = useState([]);
  const [showReg, setShowReg] = useState(false);
  const [editingEnv, setEditingEnv] = useState(null); // server id being edited
  const [envFilter, setEnvFilter] = useState('');

  const load = () => api.servers().then((servers) => {
    // merge with overview data
    api.overview().then((overview) => {
      const metricMap = Object.fromEntries(overview.map((o) => [o.id, o]));
      setRows(servers.map((s) => ({ ...s, ...metricMap[s.id] })));
    }).catch(() => setRows(servers));
  }).catch(() => {});

  useEffect(() => {
    load();
    const s = getSocket();
    if (!s) return;
    const onMetric = (m) =>
      setRows((rs) =>
        rs.map((r) =>
          r.id === m.server_id
            ? { ...r, cpu_usage: m.cpu_usage, memory_usage: m.memory_usage, disk_usage: m.disk_usage, status: 'online' }
            : r,
        ),
      );
    const onStatus = (p) =>
      setRows((rs) => rs.map((r) => (r.id === p.serverId ? { ...r, status: p.status } : r)));
    s.on('metric', onMetric);
    s.on('server_status', onStatus);
    const iv = setInterval(load, 30000);
    return () => {
      s.off('metric', onMetric);
      s.off('server_status', onStatus);
      clearInterval(iv);
    };
  }, []);

  const getEnv = (r) => r.tags?.env || '';

  const filtered = envFilter ? rows.filter((r) => getEnv(r) === envFilter) : rows;
  const onlineCount = rows.filter((r) => r.status === 'online').length;
  const offlineCount = rows.filter((r) => r.status === 'offline').length;
  const avgCpu = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.cpu_usage || 0), 0) / rows.length).toFixed(1) : 0;
  const avgMemory = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.memory_usage || 0), 0) / rows.length).toFixed(1) : 0;
  const liveCount = rows.filter((r) => getEnv(r) === 'live').length;
  const stagingCount = rows.filter((r) => getEnv(r) === 'staging').length;

  return (
    <div>
      <div className="page-head">
        <h2>Server Overview</h2>
        <button onClick={() => setShowReg(true)}>+ Add server</button>
      </div>
      {showReg && <RegisterServer onClose={() => { setShowReg(false); load(); }} />}

      {/* Summary Cards */}
      <div className="metrics-grid" style={{ marginBottom: '24px' }}>
        <div className="metric-card">
          <h3>Total Servers</h3>
          <div className="value">{rows.length}</div>
          <div className="trend">Monitoring</div>
        </div>
        <div className="metric-card">
          <h3>Online</h3>
          <div className="value" style={{ color: 'var(--ok)' }}>{onlineCount}</div>
          <div className="trend">{rows.length > 0 ? ((onlineCount / rows.length) * 100).toFixed(0) : 0}% available</div>
        </div>
        <div className="metric-card">
          <h3>Offline</h3>
          <div className="value" style={{ color: 'var(--crit)' }}>{offlineCount}</div>
          <div className="trend">Needs attention</div>
        </div>
        <div className="metric-card">
          <h3>Live</h3>
          <div className="value" style={{ color: ENV_COLORS.live }}>{liveCount}</div>
          <div className="trend">Production servers</div>
        </div>
        <div className="metric-card">
          <h3>Staging</h3>
          <div className="value" style={{ color: ENV_COLORS.staging }}>{stagingCount}</div>
          <div className="trend">Pre-prod servers</div>
        </div>
        <div className="metric-card">
          <h3>Avg CPU</h3>
          <div className="value" style={{ color: 'var(--warn)' }}>{avgCpu}%</div>
          <div className="trend">Average load</div>
        </div>
        <div className="metric-card">
          <h3>Avg Memory</h3>
          <div className="value" style={{ color: 'var(--accent)' }}>{avgMemory}%</div>
          <div className="trend">Average usage</div>
        </div>
      </div>

      {/* Filter by env */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Filter:</span>
        {['', ...ENV_OPTIONS].map((e) => (
          <button key={e} onClick={() => setEnvFilter(e)}
            style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '12px', cursor: 'pointer',
              border: `1px solid ${envFilter === e ? 'var(--accent)' : 'var(--border)'}`,
              background: envFilter === e ? 'var(--accent)' : 'var(--panel)',
              color: envFilter === e ? '#fff' : 'var(--fg)' }}>
            {e || 'All'}
          </button>
        ))}
      </div>

      {/* Servers Table */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--panel-2)' }}>
          <h3 style={{ margin: 0, fontSize: '14px' }}>Servers ({filtered.length})</h3>
        </div>
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className="grid" style={{ margin: 0, borderRadius: 0 }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--panel-2)', zIndex: 10 }}>
              <tr><th>Status</th><th>Name</th><th>Environment</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><span className={`dot ${r.status}`} title={r.status} /></td>
                  <td><Link href={`/servers/${r.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{r.name}</Link></td>
                  <td>
                    {editingEnv === r.id ? (
                      <EnvEditor serverId={r.id} currentEnv={getEnv(r)} onSaved={(val) => {
                        setRows((rs) => rs.map((s) => s.id === r.id ? { ...s, tags: { ...s.tags, env: val } } : s));
                        setEditingEnv(null);
                      }} />
                    ) : (
                      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <EnvTag env={getEnv(r)} />
                        <button onClick={() => setEditingEnv(r.id)}
                          style={{ fontSize: '10px', padding: '1px 5px', cursor: 'pointer', borderRadius: '3px',
                            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}>✎</button>
                      </span>
                    )}
                  </td>
                  <td>{bar(r.cpu_usage)}</td>
                  <td>{bar(r.memory_usage)}</td>
                  <td>{bar(r.disk_usage)}</td>
                  <td style={{ fontSize: '12px', color: 'var(--muted)' }}>{r.last_seen ? new Date(r.last_seen).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="7" className="empty">No servers match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
