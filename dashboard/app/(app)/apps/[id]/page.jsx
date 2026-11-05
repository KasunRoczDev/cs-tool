'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import FormField from '@/components/ui/FormField';
import FilterBar from '@/components/ui/FilterBar';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getPageContext } from '@/lib/navigation';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serversLoading, setServersLoading] = useState(true);
  const [serversError, setServersError] = useState('');
  const [varsLoading, setVarsLoading] = useState(false);
  const [varsError, setVarsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const loadServers = useCallback(() => {
    setServersLoading(true); setServersError('');
    return api.appServers(id).then(setServers).catch((e) => setServersError(e.message || 'Unable to load linked servers')).finally(() => setServersLoading(false));
  }, [id]);
  const loadApp = useCallback(() => {
    setLoading(true); setLoadError('');
    return api.app(id).then(setApp).catch((e) => setLoadError(e.message || 'Unable to load app')).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    loadApp();
    loadServers();
    api.servers().then(setAllServers).catch((e) => setErr(e.message || 'Unable to load available servers'));
    api.channels().then(setChannels).catch((e) => setErr(e.message || 'Unable to load variable scopes'));
  }, [id, loadApp, loadServers]);

  const guard = async (fn, m) => {
    setErr(''); setMsg(''); setSaving(true);
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); } finally { setSaving(false); }
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

  const loadVars = (channelId) => {
    setVarsLoading(true); setVarsError('');
    return api.appEnvVars(id, channelId === null ? 'none' : channelId).then(setVars).catch((e) => setVarsError(e.message || 'Unable to load variables')).finally(() => setVarsLoading(false));
  };
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

  if (!app) return <div>
    <PageHeader {...getPageContext('/apps/[id]')} title={'App details'} breadcrumbs={[{ label: 'Apps', href: '/apps' }, { label: 'App details' }]} wide />
    {loading && <FeedbackState kind="loading" title="Loading app…" />}
    {loadError && <FeedbackState kind="error" description={loadError} action={<button onClick={loadApp}>Retry</button>} />}
    <div aria-busy={loading} />
  </div>;

  const linkedServerIds = new Set(servers.map((s) => s.id));
  const availableServers = allServers.filter((s) => !linkedServerIds.has(s.id));
  const scopes = [{ id: null, name: '— general (no channel) —' }, ...channels];

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/apps/[id]')} title={app.name} description={`${app.product_name || 'No Enterprise Project'}${app.repository_name ? ` · ${app.repository_name}` : ''}`} breadcrumbs={[{ label: 'Apps', href: '/apps' }, { label: app.name }]} wide />
      {err && <FeedbackState kind="error" title="Unable to complete action" description={err} />}
      {msg && <p role="status">{msg}</p>}
      {app.description && <p className="hint" style={{ marginBottom: 16 }}>{app.description}</p>}

      <SectionHeader title="Servers hosting this app" />
      {serversLoading && <FeedbackState kind="loading" title="Loading linked servers…" />}
      {serversError && <FeedbackState kind="error" description={serversError} action={<button onClick={loadServers}>Retry</button>} />}
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select aria-label="Server to link" value={linkServerId} onChange={(e) => setLinkServerId(e.target.value)}>
          <option value="">— select server —</option>
          {availableServers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button disabled={saving || serversLoading || !linkServerId} onClick={linkServer}>{saving ? 'Saving…' : 'Link server'}</button>
      </div>
      <div aria-busy={serversLoading}>
      {(servers.length > 0 || (!serversLoading && !serversError)) && (servers.length === 0 ? (
        <FeedbackState title="Not hosted on any server yet" description="Choose a server above to link this app." />
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
      ))}
      </div>

      <SectionHeader title="Environment variables" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Scope</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scopes.map((c) => (
              <button key={c.id || 'general'} disabled={varsLoading} aria-pressed={selectedChannel?.id === c.id} onClick={() => selectChannel(c)} style={{
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
            <h3>{selectedChannel.name}</h3>
            {varsLoading && <FeedbackState kind="loading" title="Loading variables…" />}
            {varsError && <FeedbackState kind="error" description={varsError} action={<button onClick={() => loadVars(selectedChannel.id)}>Retry</button>} />}
            <div aria-busy={varsLoading}>
            {!varsLoading && !varsError && <div role="region" aria-label="Environment variables" tabIndex={0} className="focus-ring" style={{ maxWidth: '100%', overflowX: 'auto' }}><table className="grid">
              <thead><tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col"></th></tr></thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id}>
                    <td><code>{v.key}</code></td>
                    <td>{v.is_secret ? <span style={{ color: 'var(--muted)' }}>●●●●●●●● (secret)</span> : v.value}</td>
                    <td><button disabled={saving} className="btn-secondary" onClick={() => removeVar(v)}>Remove</button></td>
                  </tr>
                ))}
                {vars.length === 0 && <tr><td colSpan="3" className="empty">No variables set.</td></tr>}
              </tbody>
            </table></div>}
            </div>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); saveVar(); }}>
              <input aria-label="Variable key" placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} style={{ width: 160 }} />
              <input aria-label="Variable value" placeholder="value" type={form.is_secret ? 'password' : 'text'} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ width: 200 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={form.is_secret} onChange={(e) => setForm({ ...form, is_secret: e.target.checked })} />
                secret
              </label>
              <button type="submit" disabled={saving || varsLoading || !form.key || !form.value}>{saving ? 'Saving…' : 'Save'}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
