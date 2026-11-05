'use client';
import FilterBar from '@/components/ui/FilterBar';
import StatusBadge from '@/components/ui/StatusBadge';
import SectionHeader from '@/components/SectionHeader';
import Surface from '@/components/ui/Surface';

import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const BILLING_MODES = ['pay_per_use', 'monthly', 'annual'];
const PROVIDERS = ['AWS', 'Azure', 'Huawei Cloud', 'DigitalOcean', 'Other'];

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
        <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <input aria-label={`${keyPlaceholder} ${i + 1}`} placeholder={keyPlaceholder} value={row.key}
            onChange={(e) => update(i, 'key', e.target.value)} />
          <input aria-label={`${valuePlaceholder} ${i + 1}`} placeholder={valuePlaceholder} value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)} />
          <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ Add</button>
    </div>
  );
}

const EMPTY_FORM = {
  product_id: '', service_type_id: '', name: '', region: '', provider: '',
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
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', status: 'active', provider: '' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncTypeId, setSyncTypeId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const result = await api.billingServices(filters);
      if (current === request.current) { setServices(result); setLoaded(true); }
    } catch (e) { if (current === request.current) setLoadError(e.message); }
    finally { if (current === request.current) setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => {
    api.products().then(setProducts).catch((e) => setErr(`products: ${e.message}`));
    api.serviceTypes().then(setTypes).catch((e) => setErr(`serviceTypes: ${e.message}`));
    api.servers().then(setServers).catch((e) => setErr(`servers: ${e.message}`));
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    const body = {
      product_id: form.product_id,
      service_type_id: form.service_type_id,
      name: form.name,
      region: form.region || undefined,
      provider: form.provider || undefined,
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
    finally { setSaving(false); }
  };

  const edit = (s) => {
    setEditingId(s.id);
    setForm({
      product_id: s.product_id, service_type_id: s.service_type_id, name: s.name,
      region: s.region || '', provider: s.provider || '', billing_mode: s.billing_mode, server_id: s.server_id || '',
      specs: s.specs || [], tags: tagsObjectToRows(s.tags),
    });
  };

  const onServiceTypeChange = (typeId) => {
    const type = types.find((t) => t.id === typeId);
    const fields = type?.spec_fields || [];
    const existingByKey = Object.fromEntries(form.specs.map((r) => [r.key, r.value]));
    const specs = fields.map((key) => ({ key, value: existingByKey[key] ?? '' }));
    setForm({ ...form, service_type_id: typeId, specs });
  };

  const retire = async (s) => {
    if (!confirm(`Retire "${s.name}"? It will stop appearing in monthly billing entry.`)) return;
    try { await api.retireBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };
  const reactivate = async (s) => {
    try { await api.reactivateBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };

  const syncFromServers = async () => {
    if (!syncTypeId) { setErr('Pick a service type to use for synced servers first'); return; }
    setErr('');
    setSyncMsg('');
    setSyncing(true);
    try {
      const r = await api.syncServersToBilling(syncTypeId);
      setSyncMsg(
        `Created ${r.created.length} service(s).` +
        (r.skipped_no_project.length
          ? ` Skipped ${r.skipped_no_project.length} server(s) with no Enterprise Project assigned: ${r.skipped_no_project.map((s) => s.name).join(', ')}.`
          : ''),
      );
      load();
    } catch (e) { setErr(e.message); }
    setSyncing(false);
  };

  const productServers = servers.filter((sv) => !form.product_id || sv.product_id === form.product_id);

  return (
    <div>
      <PageHeader {...getPageContext("/billing/services")} />
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}

      <FilterBar label="Server sync">
        <FormField label="Service type for server sync"><select value={syncTypeId} onChange={(e) => setSyncTypeId(e.target.value)}>
          <option value="">— service type for synced servers —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></FormField>
        <button type="button" onClick={syncFromServers} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync from Servers'}
        </button>
      </FilterBar>
      {syncMsg && <div className="hint" style={{ marginBottom: 16 }}>{syncMsg}</div>}

      <FilterBar label="Service filters">
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
        <FormField label="Status"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
          <option value="">All</option>
        </select></FormField>
      </FilterBar>

      <form onSubmit={submit} style={{ display: 'grid', gap: 16, marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <SectionHeader title={editingId ? 'Edit service' : 'Add service'} description="Assign a project, service type, and billing mode." />
        <FormField label="Enterprise Project"><select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value, server_id: '' })}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField label="Service Type"><select required value={form.service_type_id} onChange={(e) => onServiceTypeChange(e.target.value)}>
            <option value="">— select —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </FormField>
        <FormField label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Region"><input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></FormField>
        <FormField label="Provider"><select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="">— none —</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Billing mode"><select value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })}>
            {BILLING_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </FormField>
        <FormField label="Linked server (optional)"><select value={form.server_id} onChange={(e) => setForm({ ...form, server_id: e.target.value })}>
            <option value="">— none —</option>
            {productServers.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
          </select>
        </FormField>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Specs</div>
          <KeyValueRows rows={form.specs} onChange={(specs) => setForm({ ...form, specs })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tags</div>
          <KeyValueRows rows={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save' : 'Add service'}</button>
          {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
        </div>
      </form>

      {loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing…' : 'Loading…'} />}
      {loadError && <FeedbackState kind="error" compact description={loadError} action={<button onClick={load}>Retry</button>} />}
      {loaded && !loading && !loadError && services.length === 0 && <FeedbackState kind="empty" title="No results" description="Try another filter or add a record to get started." />}
      <div className="ui-data-table ui-data-table--scroll" aria-busy={loading} role="region" aria-label="Services table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
        <thead>
          <tr><th>Project</th><th>Type</th><th>Name</th><th>Region</th><th>Provider</th><th>Billing mode</th><th>Server</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id}>
              <td>{s.product_name}</td>
              <td>{s.service_type_name}</td>
              <td><b>{s.name}</b></td>
              <td>{s.region || '—'}</td>
              <td>{s.provider || '—'}</td>
              <td>{s.billing_mode}</td>
              <td>{s.server_name || '—'}</td>
              <td><StatusBadge status={s.status}>{s.status}</StatusBadge></td>
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
    </div>
  );
}
