'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FilterBar from '@/components/ui/FilterBar';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';
import StatusBadge from '@/components/ui/StatusBadge';
import { useEffect, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(null);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('open');

  const load = () => {
    setLoading(true); setError('');
    return api.alerts(filter || undefined).then(setAlerts).catch((e) => setError(e.message || 'Unable to load alerts')).finally(() => setLoading(false));
  };

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
    setResolving(id); setError(''); setMessage('');
    try { await api.resolveAlert(id); setMessage('Alert resolved'); load(); }
    catch (e) { setError(e.message || 'Unable to resolve alert'); }
    finally { setResolving(null); }
  };

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/alerts')} wide />
      <FilterBar label="Alert filters"><FormField label="Status">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option><option value="open">Open</option><option value="resolved">Resolved</option>
        </select>
      </FormField></FilterBar>
      {loading && <FeedbackState kind="loading" title="Loading alerts…" />}
      {error && <FeedbackState kind="error" description={error} action={<button onClick={load} disabled={loading}>Retry</button>} />}
      {message && <p role="status">{message}</p>}
      <SectionHeader title="Alerts" />
      <div aria-busy={loading}>
      <div role="region" aria-label="Alerts table" tabIndex={0} className="focus-ring" style={{ maxWidth: '100%', overflowX: 'auto' }}><table className="grid">
        <thead>
          <tr><th scope="col">Severity</th><th scope="col">Type</th><th scope="col">Server</th><th scope="col">Message</th><th scope="col">When</th><th scope="col"></th></tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td><StatusBadge status={a.severity === 'high' || a.severity === 'medium' ? 'warning' : a.severity}>{a.severity}</StatusBadge></td>
              <td>{a.type}</td>
              <td>{a.server_name || '—'}</td>
              <td>{a.message}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
              <td>
                {a.status === 'open'
                  ? <button disabled={resolving !== null} onClick={() => resolve(a.id)}>{resolving === a.id ? 'Resolving…' : 'Resolve'}</button>
                  : <StatusBadge status={a.status} />}
              </td>
            </tr>
          ))}
          {!loading && !error && alerts.length === 0 && <tr><td colSpan="6" className="empty"><FeedbackState compact title="No alerts" description="No alerts match this status filter." /></td></tr>}
        </tbody>
      </table></div>
      </div>
    </div>
  );
}
