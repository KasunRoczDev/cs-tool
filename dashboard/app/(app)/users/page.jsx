'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const ROLES = ['admin', 'operator', 'viewer'];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer' });

  const load = () => api.users().then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

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
          <tr><th>Email</th><th>Role</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} style={{ width: 130 }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => reset(u.id)}>Reset pw</button>
                <button onClick={() => remove(u.id)} style={{ background: '#f87171' }}>Delete</button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan="4" className="empty">No users.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 16 }}>
        Roles — <b>admin</b>: full access incl. user &amp; server management; <b>operator</b>:
        register servers &amp; resolve alerts; <b>viewer</b>: read-only.
      </p>
    </div>
  );
}
