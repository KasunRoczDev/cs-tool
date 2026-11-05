'use client';
import FilterBar from '@/components/ui/FilterBar';

import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

export default function BillingHistoryPage() {
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', from: '', to: '' });
  const [err, setErr] = useState('');

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const result = await api.billingRecords(filters);
      if (current === request.current) { setRecords(result); setLoaded(true); }
    } catch (e) { if (current === request.current) setLoadError(e.message); }
    finally { if (current === request.current) setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.serviceTypes().then(setTypes).catch(() => {});
  }, []);

  const remove = async (r) => {
    if (!confirm(`Delete billing record for "${r.service_name}" (${r.billing_month.slice(0, 7)})?`)) return;
    try { await api.deleteBillingRecord(r.id); load(); } catch (e) { setErr(e.message); }
  };

  const exportCsv = async () => {
    try { await api.exportBillingRecordsCsv(filters); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <PageHeader {...getPageContext("/billing/history")} actions={<button onClick={exportCsv}>Export CSV</button>} />
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}

      <FilterBar label="Billing history filters">
        <FormField label="Project"><select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField>
        <FormField label="Service type"><select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></FormField>
        <FormField label="From"><input type="month" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></FormField>
        <FormField label="To"><input type="month" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></FormField>
      </FilterBar>

      {loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing…' : 'Loading…'} />}
      {loadError && <FeedbackState kind="error" compact description={loadError} action={<button onClick={load}>Retry</button>} />}
      {loaded && !loading && !loadError && records.length === 0 && <FeedbackState kind="empty" title="No results" description="Try another filter or add a record to get started." />}
      <div className="ui-data-table ui-data-table--scroll" aria-busy={loading} role="region" aria-label="History table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
        <thead>
          <tr><th>Month</th><th>Project</th><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.billing_month.slice(0, 7)}</td>
              <td>{r.product_name}</td>
              <td>{r.service_name}</td>
              <td>{r.service_type}</td>
              <td>{r.amount}</td>
              <td>{r.notes || '—'}</td>
              <td><button onClick={() => remove(r)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
    </div>
  );
}
