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

  return (
    <div>
      <div className="page-head">
        <h2>Servers</h2>
        <button onClick={() => setShowReg(true)}>+ Add server</button>
      </div>
      {showReg && <RegisterServer onClose={() => { setShowReg(false); load(); }} />}
      <table className="grid">
        <thead>
          <tr><th>Status</th><th>Name</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><span className={`dot ${r.status}`} title={r.status} /></td>
              <td><Link href={`/servers/${r.id}`}>{r.name}</Link></td>
              <td>{bar(r.cpu_usage)}</td>
              <td>{bar(r.memory_usage)}</td>
              <td>{bar(r.disk_usage)}</td>
              <td>{r.last_seen ? new Date(r.last_seen).toLocaleTimeString() : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan="6" className="empty">No servers yet. Add one to get an API key.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
