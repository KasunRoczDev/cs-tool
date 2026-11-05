'use client';
import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

export default function AccessPage() {
  const [tab, setTab] = useState('roles');
  const [err, setErr] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  // roles + permissions
  const [roles, setRoles] = useState([]);
  const [perms, setPerms] = useState([]);
  const [editing, setEditing] = useState(null); // role id -> Set of permission keys

  // members
  const [products, setProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [productId, setProductId] = useState('');
  const [members, setMembers] = useState([]);
  const [grant, setGrant] = useState({ user_id: '', role_id: '' });

  const loadRoles = useCallback(async () => {
    setLoading(true); setLoadError('');
    const results = await Promise.allSettled([api.roles(), api.permissions()]);
    if (results[0].status === 'fulfilled') setRoles(results[0].value);
    if (results[1].status === 'fulfilled') setPerms(results[1].value);
    setLoadError(results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Access data could not be loaded').join(' '));
    setLoaded(true); setLoading(false);
  }, []);

  useEffect(() => {
    loadRoles();
    api.products().then(setProducts).catch(() => {});
    api.users().then(setUsers).catch(() => {});
  }, [loadRoles]);

  useEffect(() => {
    if (productId) api.productMembers(productId).then(setMembers).catch((e) => setErr(e.message));
    else setMembers([]);
  }, [productId]);

  const permGroups = useMemo(() => {
    const m = {};
    for (const p of perms) (m[p.resource] = m[p.resource] || []).push(p);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [perms]);

  const startEdit = (role) => setEditing({ id: role.id, keys: new Set(role.permissions || []) });
  const toggleKey = (k) => setEditing((e) => {
    const keys = new Set(e.keys);
    keys.has(k) ? keys.delete(k) : keys.add(k);
    return { ...e, keys };
  });
  const saveRole = async () => {
    setErr('');
    try { await api.setRolePermissions(editing.id, [...editing.keys]); setEditing(null); notify('Role updated'); loadRoles(); }
    catch (e) { setErr(e.message); }
  };

  const addMember = async () => {
    setErr('');
    if (!grant.user_id || !grant.role_id) return setErr('Pick a user and a role');
    try { await api.addProductMember(productId, grant); setGrant({ user_id: '', role_id: '' }); notify('Member added'); api.productMembers(productId).then(setMembers); }
    catch (e) { setErr(e.message); }
  };
  const revoke = async (id) => {
    if (!confirm('Revoke this membership?')) return;
    try { await api.revokeMembership(id); api.productMembers(productId).then(setMembers); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <PageHeader {...getPageContext("/access")} />
      {tab === 'roles' && loading && <FeedbackState kind="loading" compact title={loaded ? 'Refreshing roles and permissions…' : 'Loading roles and permissions…'} />}
      {tab === 'roles' && loadError && <FeedbackState kind="error" compact title="Some access data could not be loaded" description={loadError} action={<button onClick={loadRoles} disabled={loading}>Retry</button>} />}
      {err && <FeedbackState kind="error" compact title="Request failed" description={err} />}
      {msg && <div className="hint">{msg}</div>}

      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {['roles', 'members'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
            fontWeight: tab === t ? 700 : 400, color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', textTransform: 'capitalize',
          }}>{t === 'roles' ? 'Roles & permissions' : 'Product members'}</button>
        ))}
      </div>

      {tab === 'roles' && (
        <>
        {loaded && !loading && !loadError && roles.length === 0 && <FeedbackState kind="empty" title="No roles available" />}
        <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Access table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
          <thead><tr><th>Role</th><th>Permissions</th><th>Actions</th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{r.key}{r.is_system ? ' · system' : ''}</span>
                  {r.approval_slot && <div style={{ fontSize: 11, color: 'var(--muted)' }}>sign-off: {r.approval_slot}</div>}</td>
                <td style={{ fontSize: 12 }}>
                  {editing?.id === r.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                      {permGroups.map(([res, list]) => (
                        <div key={res}>
                          <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10, color: 'var(--muted)' }}>{res}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {list.map((p) => (
                              <label key={p.key} title={p.description} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                                <input type="checkbox" checked={editing.keys.has(p.key)} onChange={() => toggleKey(p.key)} />
                                {p.key}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>{(r.permissions || []).length} permissions</span>
                  )}
                </td>
                <td>
                  {editing?.id === r.id
                    ? <div style={{ display: 'flex', gap: 6 }}><button onClick={saveRole}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></div>
                    : <button onClick={() => startEdit(r)}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
        </>
      )}

      {tab === 'members' && (
        <div>
          <div className="inline-form" style={{ marginBottom: 12 }}>
            <FormField label="Project"><select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— select product —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></FormField>
          </div>
          {productId && (
            <>
              <div className="inline-form" style={{ marginBottom: 12 }}>
                <FormField label="User"><select value={grant.user_id} onChange={(e) => setGrant({ ...grant, user_id: e.target.value })}>
                  <option value="">— user —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select></FormField>
                <FormField label="Role"><select value={grant.role_id} onChange={(e) => setGrant({ ...grant, role_id: e.target.value })}>
                  <option value="">— role —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></FormField>
                <button onClick={addMember}>Add member</button>
              </div>
              <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Access table 2" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
<table className="grid">
                <thead><tr><th>User</th><th>Role</th><th>Scope</th><th>Actions</th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.email}</td>
                      <td>{m.role_name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.role_key}</span></td>
                      <td>{m.scope_type === 'global' ? '🌐 global' : '📦 product'}</td>
                      <td>{m.scope_type === 'global' ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>inherited</span>
                        : <button onClick={() => revoke(m.id)} style={{ background: '#f87171' }}>Revoke</button>}</td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan="4" className="empty">No members.</td></tr>}
                </tbody>
              </table>
</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
