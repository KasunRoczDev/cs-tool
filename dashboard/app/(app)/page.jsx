'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import RegisterServer from '@/components/RegisterServer';

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

  const load = () => api.overview().then(setRows).catch(() => {});

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

  // Calculate summary statistics
  const onlineCount = rows.filter((r) => r.status === 'online').length;
  const offlineCount = rows.filter((r) => r.status === 'offline').length;
  const avgCpu = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.cpu_usage || 0), 0) / rows.length).toFixed(1) : 0;
  const avgMemory = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.memory_usage || 0), 0) / rows.length).toFixed(1) : 0;

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

      {/* Servers Table */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--panel-2)' }}>
          <h3 style={{ margin: 0, fontSize: '14px' }}>Servers ({rows.length})</h3>
        </div>
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className="grid" style={{ margin: 0, borderRadius: 0 }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--panel-2)', zIndex: 10 }}>
              <tr><th>Status</th><th>Name</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className={`dot ${r.status}`} title={r.status} /></td>
                  <td><Link href={`/servers/${r.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{r.name}</Link></td>
                  <td>{bar(r.cpu_usage)}</td>
                  <td>{bar(r.memory_usage)}</td>
                  <td>{bar(r.disk_usage)}</td>
                  <td style={{ fontSize: '12px', color: 'var(--muted)' }}>{r.last_seen ? new Date(r.last_seen).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="6" className="empty">No servers yet. Add one to get an API key.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Tips */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>💡 Tip</div>
          <div style={{ fontSize: '13px' }}>Click on server name to view detailed metrics and security events</div>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid var(--ok)' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>✓ Real-time</div>
          <div style={{ fontSize: '13px' }}>Metrics update automatically every 30 seconds via WebSocket</div>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid var(--warn)' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>⚠️ Alert</div>
          <div style={{ fontSize: '13px' }}>View security events in the Security Dashboard</div>
        </div>
      </div>
    </div>
  );
}
