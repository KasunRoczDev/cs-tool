'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null); // { id, name, description }

  const load = () => api.products().then(setProducts).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.createProduct(form);
      setForm({ name: '', description: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    setErr('');
    try {
      await api.updateProduct(editing.id, { name: editing.name, description: editing.description });
      setEditing(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  const remove = async (p) => {
    if (!confirm(`Delete product "${p.name}"? Its ${p.server_count} server(s) will be left unassigned.`)) return;
    setErr('');
    try { await api.deleteProduct(p.id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>📦 Products</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="product name (e.g. OMS)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="description (optional)" style={{ minWidth: 220 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button type="submit">Add product</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Name</th><th>Description</th><th>Servers</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                {editing?.id === p.id ? (
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                ) : <b>{p.name}</b>}
              </td>
              <td>
                {editing?.id === p.id ? (
                  <input value={editing.description || ''} style={{ minWidth: 220 }}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                ) : (p.description || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </td>
              <td>{p.server_count}</td>
              <td>{new Date(p.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {editing?.id === p.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing({ id: p.id, name: p.name, description: p.description })}>Edit</button>
                    <button onClick={() => remove(p)} style={{ background: '#f87171' }}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {products.length === 0 && <tr><td colSpan="5" className="empty">No products yet.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 16 }}>
        Products group servers (e.g. OMS, TransExpress). Assign a server to a product when
        registering it, or from the server&apos;s row in the Overview. Deleting a product leaves its
        servers in place, just unassigned.
      </p>
    </div>
  );
}
