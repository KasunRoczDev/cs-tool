'use client';
import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

function parseSpecFields(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function ServiceTypesPage() {
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', description: '', specFieldsText: '' });
  const [editing, setEditing] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const result = await api.serviceTypes();
      if (current === request.current) { setTypes(result); setLoaded(true); }
    } catch (e) { if (current === request.current) setLoadError(e.message); }
    finally { if (current === request.current) setLoading(false); }
  }, []);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await api.createServiceType({
        key: form.key,
        name: form.name,
        description: form.description,
        spec_fields: parseSpecFields(form.specFieldsText),
      });
      setForm({ key: '', name: '', description: '', specFieldsText: '' });
      load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveEdit = async () => {
    setErr('');
    try {
      await api.updateServiceType(editing.id, {
        key: editing.key,
        name: editing.name,
        description: editing.description,
        spec_fields: parseSpecFields(editing.specFieldsText),
      });
      setEditing(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  const remove = async (t) => {
    if (!confirm(`Delete service type "${t.name}"?`)) return;
    setErr('');
    try { await api.deleteServiceType(t.id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <PageHeader {...getPageContext("/billing/service-types")} />
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}

      <form className="inline-form" onSubmit={create}>
        <FormField label="Key"><input placeholder="key (e.g. ecs)" required
          value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></FormField>
        <FormField label="Name"><input placeholder="name (e.g. ECS)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Description"><input placeholder="description (optional)" style={{ minWidth: 220 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <FormField label="Specification fields"><input placeholder="spec fields, comma-separated (e.g. vCPU, RAM (GB), Disk (GB))" style={{ minWidth: 280 }}
          value={form.specFieldsText} onChange={(e) => setForm({ ...form, specFieldsText: e.target.value })} /></FormField>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add service type'}</button>
      </form>

      {loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing…' : 'Loading…'} />}
      {loadError && <FeedbackState kind="error" compact description={loadError} action={<button onClick={load}>Retry</button>} />}
      {loaded && !loading && !loadError && types.length === 0 && <FeedbackState kind="empty" title="No results" description="Try another filter or add a record to get started." />}
      <div className="ui-data-table ui-data-table--scroll" aria-busy={loading} role="region" aria-label="Service types table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Key</th><th>Name</th><th>Description</th><th>Spec fields</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td>
                {editing?.id === t.id ? (
                  <FormField label="Key"><input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></FormField>
                ) : <code>{t.key}</code>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <FormField label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></FormField>
                ) : <b>{t.name}</b>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <FormField label="Description"><input value={editing.description || ''} style={{ minWidth: 220 }}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></FormField>
                ) : (t.description || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <FormField label="Specification fields"><input value={editing.specFieldsText} style={{ minWidth: 280 }}
                    onChange={(e) => setEditing({ ...editing, specFieldsText: e.target.value })} /></FormField>
                ) : (
                  (t.spec_fields && t.spec_fields.length > 0)
                    ? t.spec_fields.join(', ')
                    : <span style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
              <td>{new Date(t.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {editing?.id === t.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing({
                      id: t.id, key: t.key, name: t.name, description: t.description,
                      specFieldsText: (t.spec_fields || []).join(', '),
                    })}>Edit</button>
                    <button onClick={() => remove(t)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
    </div>
  );
}
