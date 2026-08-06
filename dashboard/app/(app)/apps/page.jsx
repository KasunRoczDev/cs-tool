'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const EMPTY_FORM = { name: '', description: '', product_id: '', repository_id: '' };

export default function AppsPage() {
  const [apps, setApps] = useState([]);
  const [products, setProducts] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.apps().then(setApps).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.repositories().then(setRepositories).catch(() => {});
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const body = {
      name: form.name,
      description: form.description || undefined,
      product_id: form.product_id || undefined,
      repository_id: form.repository_id || undefined,
    };
    try {
      if (editingId) await api.updateApp(editingId, body);
      else await api.createApp(body);
      resetForm();
      load();
    } catch (e) { setErr(e.message); }
  };

  const edit = (a) => {
    setEditingId(a.id);
    setForm({
      name: a.name, description: a.description || '',
      product_id: a.product_id || '', repository_id: a.repository_id || '',
    });
  };

  const remove = async (a) => {
    if (!confirm(`Delete app "${a.name}"?`)) return;
    setErr('');
    try { await api.deleteApp(a.id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🗂️ Apps</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={submit} style={{ flexWrap: 'wrap' }}>
        <input placeholder="name (e.g. oms auth layer)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="description (optional)" style={{ minWidth: 200 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
          <option value="">— no Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={form.repository_id} onChange={(e) => setForm({ ...form, repository_id: e.target.value })}>
          <option value="">— no linked repository —</option>
          {repositories.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button type="submit">{editingId ? 'Save' : 'Add app'}</button>
        {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Name</th><th>Enterprise Project</th><th>Repository</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/apps/${a.id}`}>{a.name}</Link></td>
              <td>{a.product_name || '—'}</td>
              <td>{a.repository_name || '—'}</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => edit(a)}>Edit</button>
                <button onClick={() => remove(a)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
