'use client';
import FilterBar from '@/components/ui/FilterBar';

import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useEffect, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const PROVIDERS = ['AWS', 'Azure', 'Huawei Cloud', 'DigitalOcean', 'Other'];

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function BillingReportPage() {
  const [report, setReport] = useState(null);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [lookupError, setLookupError] = useState('');
  const [filters, setFilters] = useState({ month: currentMonthStr(), product_id: '', service_type_id: '', provider: '' });

  useEffect(() => {
    api.products().then(setProducts).catch((e) => setLookupError(e.message));
    api.serviceTypes().then(setTypes).catch((e) => setLookupError(e.message));
  }, [retry]);

  useEffect(() => {
    let active = true;
    setLoading(true); setErr('');
    api.billingReport(`${filters.month}-01`, {
      product_id: filters.product_id || undefined,
      service_type_id: filters.service_type_id || undefined,
      provider: filters.provider || undefined,
    }).then((value) => { if (active) setReport(value); }).catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters.month, filters.product_id, filters.service_type_id, filters.provider, retry]);

  const fmt = (n) => report && `${report.currency} ${Number(n).toFixed(2)}`;

  return (
    <div>
      <PageHeader {...getPageContext("/billing/report")} />
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}

      <FilterBar label="Billing report filters">
        <FormField label="Billing month"><input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} /></FormField>
        <FormField label="Project"><select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField>
        <FormField label="Service type"><select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></FormField>
        <FormField label="Provider"><select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
          <option value="">— all providers —</option>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select></FormField>
      </FilterBar>
      {lookupError && <FeedbackState kind="error" compact title="Filter options unavailable" description={lookupError} action={<button onClick={() => { setLookupError(''); setRetry((n) => n + 1); }}>Retry</button>} />}
      {err && <button onClick={() => setRetry((n) => n + 1)}>Retry report</button>}
      {loading && <FeedbackState kind="loading" title="Loading report…" />}
      {!loading && !err && report && (
        <>
          {report.projects.length === 0 ? (
            <FeedbackState kind="empty" title="No active services match these filters" description="Choose another month or project." />
          ) : (
            report.projects.map((proj) => (
              <div key={proj.product_id} className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, marginTop: 0 }}>{proj.product_name}</h2>
                <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Report table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
                  <thead><tr><th>Resource</th><th>Type</th><th>Provider</th><th style={{ textAlign: 'right' }}>Monthly Cost</th></tr></thead>
                  <tbody>
                    {proj.resources.map((r) => (
                      <tr key={r.service_id}>
                        <td>{r.name}</td>
                        <td>{r.service_type}</td>
                        <td>{r.provider || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{r.amount != null ? fmt(r.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                      <td colSpan={3}>Subtotal</td>
                      <td style={{ textAlign: 'right' }}>{fmt(proj.subtotal)}</td>
                    </tr>
                  </tfoot>
                </table>
</div>
              </div>
            ))
          )}

          <div className="card">
            <h2 style={{ fontSize: 18, marginTop: 0 }}>Monthly Cost Summary</h2>
            <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Report table 2" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
              <thead><tr><th>Project</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>
                {report.projects.map((proj) => (
                  <tr key={proj.product_id}>
                    <td>{proj.product_name}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(proj.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, fontSize: 16, borderTop: '2px solid var(--border)' }}>
                  <td>Grand Total</td>
                  <td style={{ textAlign: 'right' }}>{fmt(report.grand_total)} / month</td>
                </tr>
              </tfoot>
            </table>
</div>
          </div>
        </>
      )}
    </div>
  );
}
