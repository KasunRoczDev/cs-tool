'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const BILLING_MODES = ['pay_per_use', 'monthly', 'annual'];

function KeyValueRows({ rows, onChange, keyPlaceholder = 'key', valuePlaceholder = 'value' }) {
  const update = (i, field, value) => {
    const next = rows.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: '', value: '' }]);

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input placeholder={keyPlaceholder} value={row.key}
            onChange={(e) => update(i, 'key', e.target.value)} />
          <input placeholder={valuePlaceholder} value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)} />
          <button type="button" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ Add</button>
    </div>
  );
}

const EMPTY_FORM = {
  product_id: '', service_type_id: '', name: '', region: '',
  billing_mode: 'monthly', server_id: '', specs: [], tags: [],
};

function toTagsObject(rows) {
  const obj = {};
  for (const r of rows) if (r.key) obj[r.key] = r.value;
  return obj;
}
function tagsObjectToRows(obj = {}) {
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [servers, setServers] = useState([]);
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', status: 'active' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.billingServices(filters).then(setServices).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [filters.product_id, filters.service_type_id, filters.status]);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.serviceTypes().then(setTypes).catch(() => {});
    api.servers().then(setServers).catch(() => {});
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const body = {
      product_id: form.product_id,
      service_type_id: form.service_type_id,
      name: form.name,
      region: form.region || undefined,
      billing_mode: form.billing_mode,
      server_id: form.server_id || undefined,
      specs: form.specs.filter((r) => r.key),
      tags: toTagsObject(form.tags),
    };
    try {
      if (editingId) await api.updateBillingService(editingId, body);
      else await api.createBillingService(body);
      resetForm();
      load();
    } catch (e) { setErr(e.message); }
  };

  const edit = (s) => {
    setEditingId(s.id);
    setForm({
      product_id: s.product_id, service_type_id: s.service_type_id, name: s.name,
      region: s.region || '', billing_mode: s.billing_mode, server_id: s.server_id || '',
      specs: s.specs || [], tags: tagsObjectToRows(s.tags),
    });
  };

  const retire = async (s) => {
    if (!confirm(`Retire "${s.name}"? It will stop appearing in monthly billing entry.`)) return;
    try { await api.retireBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };
  const reactivate = async (s) => {
    try { await api.reactivateBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };

  const productServers = servers.filter((sv) => !form.product_id || sv.product_id === form.product_id);

  return (
    <div>
      <div className="page-head"><h2>🧾 Services</h2></div>
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
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
          <option value="">All</option>
        </select>
      </div>

      <form onSubmit={submit} style={{ marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3>{editingId ? 'Edit service' : 'Add service'}</h3>
        <label>Enterprise Project
          <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value, server_id: '' })}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Service Type
          <select required value={form.service_type_id} onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}>
            <option value="">— select —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Region<input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></label>
        <label>Billing mode
          <select value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })}>
            {BILLING_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Linked server (optional)
          <select value={form.server_id} onChange={(e) => setForm({ ...form, server_id: e.target.value })}>
            <option value="">— none —</option>
            {productServers.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
          </select>
        </label>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Specs</div>
          <KeyValueRows rows={form.specs} onChange={(specs) => setForm({ ...form, specs })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tags</div>
          <KeyValueRows rows={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit">{editingId ? 'Save' : 'Add service'}</button>
          {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
        </div>
      </form>

      <table className="grid">
        <thead>
          <tr><th>Project</th><th>Type</th><th>Name</th><th>Region</th><th>Billing mode</th><th>Server</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} style={{ opacity: s.status === 'retired' ? 0.5 : 1 }}>
              <td>{s.product_name}</td>
              <td>{s.service_type_name}</td>
              <td><b>{s.name}</b></td>
              <td>{s.region || '—'}</td>
              <td>{s.billing_mode}</td>
              <td>{s.server_name || '—'}</td>
              <td>{s.status}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => edit(s)}>Edit</button>
                {s.status === 'active'
                  ? <button onClick={() => retire(s)}>Retire</button>
                  : <button onClick={() => reactivate(s)}>Reactivate</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
