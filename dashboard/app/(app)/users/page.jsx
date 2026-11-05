'use client';
import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const ROLES = ['admin', 'operator', 'viewer'];
const APPROVAL_ROLES = [
  { v: '', label: '— none —' },
  { v: 'qa', label: 'QA' },
  { v: 'ba', label: 'BA' },
  { v: 'dev_lead', label: 'DEV Lead' },
  { v: 'tech_lead', label: 'Tech Lead' },
];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer' });

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const result = await api.users();
      if (current === request.current) { setUsers(result); setLoaded(true); }
    } catch (e) { if (current === request.current) setLoadError(e.message); }
    finally { if (current === request.current) setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    api.products().then(setProducts).catch((e) => setErr(`Projects: ${e.message}`));
    return () => { request.current += 1; };
  }, [load]);

  // Update a user's approval role/product (endpoint sets both together).
  const changeApproval = async (u, patch) => {
    setErr('');
    try {
      await api.setUserApprovalProfile(u.id, {
        approval_role: patch.approval_role !== undefined ? patch.approval_role : (u.approval_role || ''),
        product_id: patch.product_id !== undefined ? patch.product_id : (u.product_id || ''),
      });
      load();
    } catch (e) { setErr(e.message); }
  };

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await api.createUser(form);
      setForm({ email: '', password: '', role: 'viewer' });
      load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const changeRole = async (id, role) => {
    setErr('');
    try { await api.setUserRole(id, role); load(); } catch (e) { setErr(e.message); }
  };

  const reset = async (id) => {
    const pw = prompt('New password (min 6 chars):');
    if (!pw) return;
    try { await api.setUserPassword(id, pw); alert('Password updated'); } catch (e) { setErr(e.message); }
  };

  const remove = async (id) => {
    if (!confirm(`Delete ${users.find((u) => u.id === id)?.email || 'this user'}? This cannot be undone.`)) return;
    try { await api.deleteUser(id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <PageHeader {...getPageContext("/users")} />
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}

      <form className="inline-form" onSubmit={create}>
        <FormField label="Email"><input placeholder="email" type="email" required
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
        <FormField label="Password"><input placeholder="password" type="password" required minLength={6}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></FormField>
        <FormField label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select></FormField>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add user'}</button>
      </form>

      {loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing…' : 'Loading…'} />}
      {loadError && <FeedbackState kind="error" compact description={loadError} action={<button onClick={load}>Retry</button>} />}
      {loaded && !loading && !loadError && users.length === 0 && <FeedbackState kind="empty" title="No results" description="Try another filter or add a record to get started." />}
      <div className="ui-data-table ui-data-table--scroll" aria-busy={loading} role="region" aria-label="Users table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Email</th><th>Role</th><th>Approval role</th><th>Product</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>
                <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} style={{ width: 120 }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>
                <select aria-label={`Approval role for ${u.email}`} value={u.approval_role || ''} onChange={(e) => changeApproval(u, { approval_role: e.target.value })} style={{ width: 120 }}>
                  {APPROVAL_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </td>
              <td>
                <select aria-label={`Product for ${u.email}`} value={u.product_id || ''} onChange={(e) => changeApproval(u, { product_id: e.target.value })} style={{ width: 140 }}>
                  <option value="">— none —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => reset(u.id)}>Reset password</button>
                <button onClick={() => remove(u.id)} style={{ background: 'var(--panel)', color: 'var(--ui-critical)', border: '1px solid var(--ui-critical)' }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
      <p className="hint" style={{ marginTop: 16 }}>
        Roles — <b>admin</b>: full access incl. user &amp; server management; <b>operator</b>:
        register servers &amp; resolve alerts; <b>viewer</b>: read-only.
        <br />
        <b>Approval role + Product</b>: users with an approval role (QA / BA / DEV Lead / Tech Lead)
        on a product must all sign off on a release of that product before it can be deployed or promoted.
      </p>
    </div>
  );
}
