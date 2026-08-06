'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import ServerAppConfigCard from '@/components/ServerAppConfigCard';

export default function AppDetailPage() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [servers, setServers] = useState([]);
  const [allServers, setAllServers] = useState([]);
  const [linkServerId, setLinkServerId] = useState('');
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null); // { id: string|null, name }
  const [vars, setVars] = useState([]);
  const [form, setForm] = useState({ key: '', value: '', is_secret: false });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const loadServers = () => api.appServers(id).then(setServers).catch((e) => setErr(e.message));

  useEffect(() => {
    if (!id) return;
    api.app(id).then(setApp).catch((e) => setErr(e.message));
    loadServers();
    api.servers().then(setAllServers).catch(() => {});
    api.channels().then(setChannels).catch(() => {});
  }, [id]);

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const linkServer = () => guard(async () => {
    if (!linkServerId) { setErr('Pick a server first'); return; }
    await api.linkServerApp(linkServerId, { app_id: id });
    setLinkServerId('');
    await loadServers();
  }, 'Linked');

  const unlinkServer = (s) => guard(async () => {
    if (!confirm(`Unlink "${s.name}"?`)) return;
    await api.unlinkServerApp(s.id, id);
    await loadServers();
  }, 'Unlinked');

  const loadVars = (channelId) =>
    api.appEnvVars(id, channelId === null ? 'none' : channelId).then(setVars).catch((e) => setErr(e.message));
  const selectChannel = (ch) => { setSelectedChannel(ch); setErr(''); loadVars(ch.id); };

  const saveVar = () => guard(async () => {
    if (!form.key || !form.value) { setErr('Key and value are required'); return; }
    await api.upsertAppEnvVar(id, { ...form, channel_id: selectedChannel.id || undefined });
    setForm({ key: '', value: '', is_secret: false });
    await loadVars(selectedChannel.id);
  }, 'Saved');

  const removeVar = (v) => guard(async () => {
    if (!confirm(`Delete "${v.key}"?`)) return;
    await api.deleteAppEnvVar(id, v.id);
    await loadVars(selectedChannel.id);
  }, 'Deleted');

  if (!app) return <div>Loading…</div>;

  const linkedServerIds = new Set(servers.map((s) => s.id));
  const availableServers = allServers.filter((s) => !linkedServerIds.has(s.id));
  const scopes = [{ id: null, name: '— general (no channel) —' }, ...channels];

  return (
    <div>
      <div className="page-head">
        <h2>🗂️ {app.name}</h2>
        <span className="muted">
          {app.product_name || 'No Enterprise Project'}{app.repository_name ? ` · ${app.repository_name}` : ''}
        </span>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      {app.description && <p className="hint" style={{ marginBottom: 16 }}>{app.description}</p>}

      <h3>Servers hosting this app</h3>
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select value={linkServerId} onChange={(e) => setLinkServerId(e.target.value)}>
          <option value="">— select server —</option>
          {availableServers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={linkServer}>Link server</button>
      </div>
      {servers.length === 0 ? (
        <p className="empty">Not hosted on any server yet.</p>
      ) : (
        servers.map((s) => (
          <ServerAppConfigCard
            key={s.server_app_id}
            title={s.name}
            config={s}
            onSave={(edits) => api.updateServerApp(s.id, id, edits).then(loadServers)}
            onUnlink={() => unlinkServer(s)}
          />
        ))
      )}

      <h3 style={{ marginTop: 24 }}>Environment variables</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Scope</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scopes.map((c) => (
              <button key={c.id || 'general'} onClick={() => selectChannel(c)} style={{
                textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                background: selectedChannel?.id === c.id ? 'var(--panel-2)' : 'transparent',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {!selectedChannel ? (
          <p className="empty">Select a scope to manage its variables.</p>
        ) : (
          <div>
            <h4>{selectedChannel.name}</h4>
            <table className="grid">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id}>
                    <td><code>{v.key}</code></td>
                    <td>{v.is_secret ? <span style={{ color: 'var(--muted)' }}>●●●●●●●● (secret)</span> : v.value}</td>
                    <td><button style={{ background: '#f87171' }} onClick={() => removeVar(v)}>Remove</button></td>
                  </tr>
                ))}
                {vars.length === 0 && <tr><td colSpan="3" className="empty">No variables set.</td></tr>}
              </tbody>
            </table>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); saveVar(); }}>
              <input placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} style={{ width: 160 }} />
              <input placeholder="value" type={form.is_secret ? 'password' : 'text'} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ width: 200 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={form.is_secret} onChange={(e) => setForm({ ...form, is_secret: e.target.checked })} />
                secret
              </label>
              <button type="submit">Save</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
