'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function BillingHistoryPage() {
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', from: '', to: '' });
  const [err, setErr] = useState('');

  const load = () => api.billingRecords(filters).then(setRecords).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [filters.product_id, filters.service_type_id, filters.from, filters.to]);
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
      <div className="page-head">
        <h2>📜 Billing History</h2>
        <button onClick={exportCsv}>Export CSV</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="month" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="month" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>

      <table className="grid">
        <thead>
          <tr><th>Month</th><th>Project</th><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr>
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
  );
}
