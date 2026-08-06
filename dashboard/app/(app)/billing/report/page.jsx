'use client';
import { useEffect, useState } from 'react';
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
  const [filters, setFilters] = useState({ month: currentMonthStr(), product_id: '', service_type_id: '', provider: '' });

  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.serviceTypes().then(setTypes).catch(() => {});
  }, []);

  useEffect(() => {
    api.billingReport(`${filters.month}-01`, {
      product_id: filters.product_id || undefined,
      service_type_id: filters.service_type_id || undefined,
      provider: filters.provider || undefined,
    }).then(setReport).catch((e) => setErr(e.message));
  }, [filters.month, filters.product_id, filters.service_type_id, filters.provider]);

  const fmt = (n) => report && `${report.currency} ${Number(n).toFixed(2)}`;

  return (
    <div>
      <div className="page-head"><h2>📋 Billing Report</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} />
        <select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
          <option value="">— all providers —</option>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {!report ? <p>Loading…</p> : (
        <>
          {report.projects.length === 0 ? (
            <p className="empty">No active services match these filters.</p>
          ) : (
            report.projects.map((proj) => (
              <div key={proj.product_id} className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ marginTop: 0 }}>{proj.product_name}</h4>
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
            ))
          )}

          <div className="card">
            <h4 style={{ marginTop: 0 }}>Monthly Cost Summary</h4>
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
        </>
      )}
    </div>
  );
}
