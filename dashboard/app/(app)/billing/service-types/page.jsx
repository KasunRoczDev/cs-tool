'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ServiceTypesPage() {
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [editing, setEditing] = useState(null);

  const load = () => api.serviceTypes().then(setTypes).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.createServiceType(form);
      setForm({ key: '', name: '', description: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    setErr('');
    try {
      await api.updateServiceType(editing.id, { key: editing.key, name: editing.name, description: editing.description });
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
        <button type="submit">Add service type</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Key</th><th>Name</th><th>Description</th><th>Created</th><th></th></tr>
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
              <td>{new Date(t.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {editing?.id === t.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing({ id: t.id, key: t.key, name: t.name, description: t.description })}>Edit</button>
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
