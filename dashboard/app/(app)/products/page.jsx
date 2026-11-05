'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import FormField from '@/components/ui/FormField';
import { useEffect, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null); // { id, name, description }

  const load = () => {
    setLoading(true); setLoadError('');
    return api.products().then(setProducts).catch((e) => setLoadError(e.message || 'Unable to load products')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr(''); setMessage(''); setSaving(true);
    try {
      await api.createProduct(form);
      setForm({ name: '', description: '' });
      load(); setMessage('Changes saved');
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    setErr(''); setMessage(''); setSaving(true);
    try {
      await api.updateProduct(editing.id, { name: editing.name, description: editing.description });
      setEditing(null);
      load(); setMessage('Changes saved');
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const remove = async (p) => {
    if (!confirm(`Delete product "${p.name}"? Its ${p.server_count} server(s) will be left unassigned.`)) return;
    setErr(''); setMessage(''); setSaving(true);
    try { await api.deleteProduct(p.id); load(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/products')} wide />
      {err && <FeedbackState kind="error" title="Unable to save changes" description={err} />}
      {message && <p role="status">{message}</p>}
      {loading && <FeedbackState kind="loading" title="Loading products…" />}
      {loadError && <FeedbackState kind="error" description={loadError} action={<button disabled={saving} onClick={load}>Retry</button>} />}

      <SectionHeader title="Add product" />
      <form className="inline-form" onSubmit={create}>
        <FormField label="Name"><input placeholder="product name (e.g. OMS)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Description"><input placeholder="description (optional)" style={{ minWidth: 0, maxWidth: '100%' }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <button type="submit" disabled={saving}>Add product</button>
      </form>

      <SectionHeader title="Products" />
      <div aria-busy={loading}>
      <div role="region" aria-label="Products table" tabIndex={0} className="focus-ring" style={{ maxWidth: '100%', overflowX: 'auto' }}><table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Servers</th><th scope="col">Created</th><th scope="col"></th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                {editing?.id === p.id ? (
                  <input aria-label="Product name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                ) : <b>{p.name}</b>}
              </td>
              <td>
                {editing?.id === p.id ? (
                  <input aria-label="Product description" value={editing.description || ''} style={{ minWidth: 0, maxWidth: '100%' }}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                ) : (p.description || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </td>
              <td>{p.server_count}</td>
              <td>{new Date(p.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {editing?.id === p.id ? (
                  <>
                    <button disabled={saving} onClick={saveEdit}>Save</button>
                    <button disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button disabled={saving} onClick={() => setEditing({ id: p.id, name: p.name, description: p.description })}>Edit</button>
                    <button disabled={saving} onClick={() => remove(p)} style={{ background: '#f87171' }}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!loading && !loadError && products.length === 0 && <tr><td colSpan="5" className="empty"><FeedbackState compact title="No products yet" description="Add a product to organize your servers." /></td></tr>}
        </tbody>
      </table></div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Products group servers (e.g. OMS, TransExpress). Assign a server to a product when
        registering it, or from the server&apos;s row in the Overview. Deleting a product leaves its
        servers in place, just unassigned.
      </p>
    </div>
  );
}
