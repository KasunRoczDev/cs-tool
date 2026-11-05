'use client';
import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const TYPE_COLORS = {
  release_status: '#3b82f6', deployment: '#06b6d4', approval: '#eab308', account: '#64748b',
};

export default function AuditLogPage() {
  const [releases, setReleases] = useState([]);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0);
  const [filters, setFilters] = useState({ release_id: '', type: '', from: '', to: '' });

  useEffect(() => { api.releases().then(setReleases).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setErr('');
    try {
      const result = await api.auditLog({
        release_id: filters.release_id || undefined,
        type: filters.type || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
      });
      if (current === requestId.current) { setRows(result); setLoaded(true); }
    } catch (e) { if (current === requestId.current) setErr(e.message); }
    finally { if (current === requestId.current) setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); return () => { requestId.current += 1; }; }, [load]);

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
      <PageHeader {...getPageContext("/audit-log")} />
      {loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing audit events…' : 'Loading audit events…'} />}
      {err && <FeedbackState kind="error" compact title="Unable to load audit events" description={err} action={<button onClick={load} disabled={loading}>Retry</button>} />}
      {loaded && !loading && !err && rows.length === 0 && <FeedbackState kind="empty" title="No audit events" description="No events match the selected filters." />}
      <p className="hint" style={{ marginBottom: 16 }}>
        A unified, read-only timeline over release status transitions, deployment
        status transitions, approval decisions, and account actions — each already
        recorded by the feature it belongs to; this just surfaces and lets you
        filter/export them. Requires the <code>audit.read</code> permission.
        Mapping this to a specific compliance framework (SOX/ISO 27001/PCI DSS/HIPAA)
        is a controls exercise for your compliance team — this is the evidence, not the report.
      </p>

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <FormField label="Release"><select value={filters.release_id} onChange={(e) => setFilters({ ...filters, release_id: e.target.value })}>
          <option value="">— all releases —</option>
          {releases.map((r) => <option key={r.id} value={r.id}>{r.version}</option>)}
        </select></FormField>
        <FormField label="Event type"><select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">— all types —</option>
          <option value="release_status">release status</option>
          <option value="deployment">deployment</option>
          <option value="approval">approval</option>
          <option value="account">account</option>
        </select></FormField>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>from
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={{ display: 'block' }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>to
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={{ display: 'block' }} />
        </label>
        <button onClick={exportCsv}>⬇ Export CSV</button>
      </div>

      <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Audit log table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
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
          {loaded && !loading && !err && rows.length === 0 && <tr><td colSpan="6" className="empty">No audit events match these filters.</td></tr>}
        </tbody>
      </table>
</div>
    </div>
  );
}
