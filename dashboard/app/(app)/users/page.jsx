'use client';
import { useEffect, useState } from 'react';
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
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer' });

  const load = () => api.users().then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.products().then(setProducts).catch(() => {});
  }, []);

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
    try {
      await api.createUser(form);
      setForm({ email: '', password: '', role: 'viewer' });
      load();
    } catch (e) { setErr(e.message); }
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
    if (!confirm('Delete this user?')) return;
    try { await api.deleteUser(id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>Users &amp; roles</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="email" type="email" required
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="password" type="password" required minLength={6}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit">Add user</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Email</th><th>Role</th><th>Approval role</th><th>Product</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} style={{ width: 120 }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>
                <select value={u.approval_role || ''} onChange={(e) => changeApproval(u, { approval_role: e.target.value })} style={{ width: 120 }}>
                  {APPROVAL_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </td>
              <td>
                <select value={u.product_id || ''} onChange={(e) => changeApproval(u, { product_id: e.target.value })} style={{ width: 140 }}>
                  <option value="">— none —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => reset(u.id)}>Reset pw</button>
                <button onClick={() => remove(u.id)} style={{ background: '#f87171' }}>Delete</button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan="6" className="empty">No users.</td></tr>}
        </tbody>
      </table>
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
