'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('open');

  const load = () => api.alerts(filter || undefined).then(setAlerts).catch(() => {});

  useEffect(() => {
    load();
    const s = getSocket();
    if (!s) return;
    const onAlert = () => load();
    s.on('alert', onAlert);
    return () => s.off('alert', onAlert);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const resolve = async (id) => {
    await api.resolveAlert(id);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <h2>Alerts</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      <table className="grid">
        <thead>
          <tr><th>Severity</th><th>Type</th><th>Server</th><th>Message</th><th>When</th><th></th></tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td><span className={`pill sev-${a.severity}`}>{a.severity}</span></td>
              <td>{a.type}</td>
              <td>{a.server_name || '—'}</td>
              <td>{a.message}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
              <td>
                {a.status === 'open'
                  ? <button onClick={() => resolve(a.id)}>Resolve</button>
                  : <span className="muted">resolved</span>}
              </td>
            </tr>
          ))}
          {alerts.length === 0 && <tr><td colSpan="6" className="empty">No alerts.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
