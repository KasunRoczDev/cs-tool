'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const TYPE_COLORS = {
  release_status: '#3b82f6', deployment: '#06b6d4', approval: '#eab308', account: '#64748b',
};

export default function AuditLogPage() {
  const [releases, setReleases] = useState([]);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({ release_id: '', type: '', from: '', to: '' });

  useEffect(() => { api.releases().then(setReleases).catch(() => {}); }, []);

  const load = () => api.auditLog({
    release_id: filters.release_id || undefined,
    type: filters.type || undefined,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(filters.to).toISOString() : undefined,
  }).then(setRows).catch((e) => setErr(e.message));

  useEffect(() => { load(); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    setErr('');
    try {
      await api.exportAuditLogCsv({
        release_id: filters.release_id || undefined,
        type: filters.type || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
      });
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🧾 Audit Log</h2></div>
      {err && <div className="error">{err}</div>}
      <p className="hint" style={{ marginBottom: 16 }}>
        A unified, read-only timeline over release status transitions, deployment
        status transitions, approval decisions, and account actions — each already
        recorded by the feature it belongs to; this just surfaces and lets you
        filter/export them. Requires the <code>audit.read</code> permission.
        Mapping this to a specific compliance framework (SOX/ISO 27001/PCI DSS/HIPAA)
        is a controls exercise for your compliance team — this is the evidence, not the report.
      </p>

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={filters.release_id} onChange={(e) => setFilters({ ...filters, release_id: e.target.value })}>
          <option value="">— all releases —</option>
          {releases.map((r) => <option key={r.id} value={r.id}>{r.version}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">— all types —</option>
          <option value="release_status">release status</option>
          <option value="deployment">deployment</option>
          <option value="approval">approval</option>
          <option value="account">account</option>
        </select>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>from
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={{ display: 'block' }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>to
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={{ display: 'block' }} />
        </label>
        <button onClick={exportCsv}>⬇ Export CSV</button>
      </div>

      <table className="grid">
        <thead><tr><th>When</th><th>Type</th><th>Release/Subject</th><th>Summary</th><th>Actor</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.type}-${r.id}`}>
              <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
              <td>
                <span style={{
                  background: TYPE_COLORS[r.type] || '#64748b', color: '#fff',
                  padding: '2px 8px', borderRadius: 12, fontSize: 11,
                }}>{r.type.replace('_', ' ')}</span>
              </td>
              <td>{r.subject || '—'}</td>
              <td>{r.summary}</td>
              <td style={{ fontSize: 12 }}>{r.actor_email || <span style={{ color: 'var(--muted)' }}>system</span>}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="6" className="empty">No audit events match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
