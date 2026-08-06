'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

function parseSpecFields(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function ServiceTypesPage() {
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ key: '', name: '', description: '', specFieldsText: '' });
  const [editing, setEditing] = useState(null);

  const load = () => api.serviceTypes().then(setTypes).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
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
      <div className="page-head"><h2>🏷️ Service Types</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="key (e.g. ecs)" required
          value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        <input placeholder="name (e.g. ECS)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="description (optional)" style={{ minWidth: 220 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input placeholder="spec fields, comma-separated (e.g. vCPU, RAM (GB), Disk (GB))" style={{ minWidth: 280 }}
          value={form.specFieldsText} onChange={(e) => setForm({ ...form, specFieldsText: e.target.value })} />
        <button type="submit">Add service type</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Key</th><th>Name</th><th>Description</th><th>Spec fields</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} />
                ) : <code>{t.key}</code>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                ) : <b>{t.name}</b>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.description || ''} style={{ minWidth: 220 }}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                ) : (t.description || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.specFieldsText} style={{ minWidth: 280 }}
                    onChange={(e) => setEditing({ ...editing, specFieldsText: e.target.value })} />
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
  );
}
