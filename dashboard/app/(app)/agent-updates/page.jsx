'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AgentUpdatesPage() {
  const [releases, setReleases] = useState([]);
  const [servers, setServers] = useState([]);
  const [settings, setSettings] = useState({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const [form, setForm] = useState({ version: '', changelog: '', rollout_percent: '0' });
  const [pkgFile, setPkgFile] = useState(null);
  const [sigFile, setSigFile] = useState(null);

  const load = () => {
    api.agentReleases().then(setReleases).catch((e) => setErr(e.message));
    api.servers().then(setServers).catch((e) => setErr(e.message));
    api.getSettings().then(setSettings).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const toggleGlobalEnabled = () => guard(async () => {
    const next = settings.agent_auto_update_enabled === 'true' ? 'false' : 'true';
    await api.saveSettings({ agent_auto_update_enabled: next });
    load();
  }, 'Saved');

  const publish = () => guard(async () => {
    if (!pkgFile || !sigFile || !form.version) return setErr('Version, .deb, and .sig are all required');
    const fd = new FormData();
    fd.append('version', form.version);
    fd.append('changelog', form.changelog);
    fd.append('rollout_percent', form.rollout_percent);
    fd.append('package', pkgFile);
    const signature = (await sigFile.text()).trim();
    fd.append('signature', signature);
    await api.publishAgentRelease(fd);
    setForm({ version: '', changelog: '', rollout_percent: '0' });
    setPkgFile(null); setSigFile(null);
    load();
  }, 'Published');

  const setRollout = (id, rollout_percent) => guard(async () => {
    await api.updateAgentRelease(id, { rollout_percent: Number(rollout_percent) });
    load();
  });

  const toggleActive = (r) => guard(async () => {
    await api.updateAgentRelease(r.id, { is_active: !r.is_active });
    load();
  }, r.is_active ? 'Disabled' : 'Enabled');

  const toggleExcluded = (s) => guard(async () => {
    await api.updateServer(s.id, { agent_auto_update_excluded: !s.agent_auto_update_excluded });
    load();
  });

  return (
    <div>
      <div className="page-head"><h2>🛰️ Agent Updates</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      <p className="hint" style={{ marginBottom: 16 }}>
        Publish signed monitor-agent releases; installed agents pull and
        self-apply them (download → verify signature → restart → auto
        rollback on failure) once eligible. Nothing rolls out unless the
        global switch below is on, the release is active, and the server
        falls inside its rollout percent.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.agent_auto_update_enabled === 'true'}
            onChange={toggleGlobalEnabled}
          />
          <b>Agent auto-update enabled (global kill switch)</b>
        </label>
      </div>

      <h3>Publish a new release</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <form className="inline-form" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); publish(); }}>
          <input placeholder="version (e.g. 1.2.0)" value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })} style={{ width: 160 }} />
          <input placeholder="changelog (optional)" value={form.changelog}
            onChange={(e) => setForm({ ...form, changelog: e.target.value })} style={{ width: 260 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            rollout %
            <input type="number" min="0" max="100" value={form.rollout_percent}
              onChange={(e) => setForm({ ...form, rollout_percent: e.target.value })} style={{ width: 70 }} />
          </label>
          <label style={{ fontSize: 13 }}>
            .deb <input type="file" accept=".deb" onChange={(e) => setPkgFile(e.target.files[0])} />
          </label>
          <label style={{ fontSize: 13 }}>
            .sig <input type="file" accept=".sig" onChange={(e) => setSigFile(e.target.files[0])} />
          </label>
          <button type="submit">Publish</button>
        </form>
      </div>

      <h3>Releases</h3>
      <table className="grid">
        <thead><tr><th>Version</th><th>Changelog</th><th>Rollout %</th><th>Active</th><th>Published</th></tr></thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r.id}>
              <td><code>{r.version}</code></td>
              <td>{r.changelog || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td>
                <input type="number" min="0" max="100" defaultValue={r.rollout_percent} style={{ width: 60 }}
                  onBlur={(e) => e.target.value != r.rollout_percent && setRollout(r.id, e.target.value)} />
              </td>
              <td>
                <button style={{ background: r.is_active ? '#22c55e' : '#ef4444' }} onClick={() => toggleActive(r)}>
                  {r.is_active ? 'Active' : 'Disabled'}
                </button>
              </td>
              <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
            </tr>
          ))}
          {releases.length === 0 && <tr><td colSpan="5" className="empty">No agent releases published yet.</td></tr>}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Servers</h3>
      <table className="grid">
        <thead><tr><th>Server</th><th>Agent version</th><th>Update status</th><th>Last update</th><th>Excluded</th></tr></thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.agent_version || <span style={{ color: 'var(--muted)' }}>unknown</span>}</td>
              <td>{s.agent_update_status}</td>
              <td>{s.agent_last_update_at ? new Date(s.agent_last_update_at).toLocaleString() : <span style={{ color: 'var(--muted)' }}>never</span>}</td>
              <td>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!s.agent_auto_update_excluded} onChange={() => toggleExcluded(s)} />
                  excluded
                </label>
              </td>
            </tr>
          ))}
          {servers.length === 0 && <tr><td colSpan="5" className="empty">No servers registered.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
