'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import FormField from '@/components/ui/FormField';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const EMPTY_FORM = { name: '', description: '', product_id: '', repository_id: '' };

export default function AppsPage() {
  const [apps, setApps] = useState([]);
  const [products, setProducts] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => {
    setLoading(true); setLoadError('');
    return api.apps().then(setApps).catch((e) => setLoadError(e.message || 'Unable to load apps')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.repositories().then(setRepositories).catch(() => {});
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMessage(''); setSaving(true);
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
      load(); setMessage('Changes saved');
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
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
    setErr(''); setMessage(''); setSaving(true);
    try { await api.deleteApp(a.id); load(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/apps')} wide />
      {err && <FeedbackState kind="error" title="Unable to save changes" description={err} />}
      {message && <p role="status">{message}</p>}
      {loading && <FeedbackState kind="loading" title="Loading apps…" />}
      {loadError && <FeedbackState kind="error" description={loadError} action={<button disabled={saving} onClick={load}>Retry</button>} />}

      <SectionHeader title="Add or edit app" />
      <form className="inline-form" onSubmit={submit} style={{ flexWrap: 'wrap' }}>
        <FormField label="Name"><input placeholder="name (e.g. oms auth layer)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Description"><input placeholder="description (optional)" style={{ minWidth: 0, maxWidth: '100%' }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <FormField label="Enterprise project"><select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
          <option value="">— no Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField>
        <FormField label="Repository"><select value={form.repository_id} onChange={(e) => setForm({ ...form, repository_id: e.target.value })}>
          <option value="">— no linked repository —</option>
          {repositories.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></FormField>
        <button type="submit" disabled={saving}>{editingId ? 'Save' : 'Add app'}</button>
        {editingId && <button type="button" disabled={saving} onClick={resetForm}>Cancel</button>}
      </form>

      <SectionHeader title="Apps" />
      <div aria-busy={loading}>
      <div role="region" aria-label="Apps table" tabIndex={0} className="focus-ring" style={{ maxWidth: '100%', overflowX: 'auto' }}><table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Enterprise Project</th><th scope="col">Repository</th><th scope="col">Created</th><th scope="col"></th></tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/apps/${a.id}`}>{a.name}</Link></td>
              <td>{a.product_name || '—'}</td>
              <td>{a.repository_name || '—'}</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button disabled={saving} onClick={() => edit(a)}>Edit</button>
                <button disabled={saving} onClick={() => remove(a)}>Delete</button>
              </td>
            </tr>
          ))}
          {!loading && !loadError && apps.length === 0 && <tr><td colSpan={5}><FeedbackState compact title="No apps yet" description="Add an app to link its repository and servers." /></td></tr>}
        </tbody>
      </table></div>
      </div>
    </div>
  );
}
