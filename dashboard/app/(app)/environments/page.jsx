'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function EnvironmentsPage() {
  const [channels, setChannels] = useState([]);
  const [products, setProducts] = useState([]);
  const [me, setMe] = useState(null);
  const [selected, setSelected] = useState(null);
  const [vars, setVars] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const [form, setForm] = useState({ key: '', value: '', is_secret: false, product_id: '' });
  const [lockReason, setLockReason] = useState('');

  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [diff, setDiff] = useState(null);

  const isAdmin = me?.role === 'admin';

  const loadChannels = () => api.channels().then(setChannels).catch((e) => setErr(e.message));
  useEffect(() => {
    loadChannels();
    api.products().then(setProducts).catch(() => {});
    api.me().then(setMe).catch(() => {});
  }, []);

  const loadVars = (channelId) => api.channelEnvVars(channelId).then(setVars).catch((e) => setErr(e.message));
  const select = (ch) => { setSelected(ch); setErr(''); loadVars(ch.id); };

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const saveVar = () => guard(async () => {
    if (!form.key || !form.value) return setErr('Key and value are required');
    await api.upsertEnvVar(selected.id, { ...form, product_id: form.product_id || undefined });
    setForm({ key: '', value: '', is_secret: false, product_id: '' });
    await loadVars(selected.id);
  }, 'Saved');

  const removeVar = (v) => guard(async () => {
    if (!confirm(`Delete "${v.key}"${v.product_name ? ` (${v.product_name})` : ''}?`)) return;
    await api.deleteEnvVar(selected.id, v.id);
    await loadVars(selected.id);
  }, 'Deleted');

  const toggleLock = () => guard(async () => {
    if (selected.locked) {
      await api.unlockChannel(selected.id);
    } else {
      await api.lockChannel(selected.id, lockReason || undefined);
      setLockReason('');
    }
    const fresh = await api.channels();
    setChannels(fresh);
    setSelected(fresh.find((c) => c.id === selected.id));
  }, selected.locked ? 'Unlocked' : 'Locked');

  const runCompare = () => guard(async () => {
    if (!compareA || !compareB) return setErr('Pick two channels to compare');
    setDiff(await api.compareChannelEnv(compareA, compareB));
  });

  return (
    <div>
      <div className="page-head"><h2>🌐 Environments</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      <p className="hint" style={{ marginBottom: 16 }}>
        Per-channel environment variables and secrets, injected into the deploy
        pipeline as a <code>.env</code> file on the target server (secret values
        are encrypted at rest and never shown again after saving). A product-scoped
        var overrides a same-key global one for that product&apos;s repos. Locking a
        channel blocks deploys the same way a freeze window does.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Channels</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {channels.map((c) => (
              <button key={c.id} onClick={() => select(c)} style={{
                textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                background: selected?.id === c.id ? 'var(--panel-2)' : 'transparent',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>
                <b>{c.name}</b>
                {c.locked && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444' }}>🔒 locked</span>}
              </button>
            ))}
          </div>
        </div>

        {!selected ? (
          <p className="empty">Select a channel to manage its environment.</p>
        ) : (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {!selected.locked && (
                      <input placeholder="lock reason (optional)" value={lockReason}
                        onChange={(e) => setLockReason(e.target.value)} style={{ fontSize: 12 }} />
                    )}
                    <button style={{ background: selected.locked ? '#22c55e' : '#ef4444' }} onClick={toggleLock}>
                      {selected.locked ? 'Unlock' : 'Lock'}
                    </button>
                  </div>
                )}
              </div>
              {selected.locked && (
                <p className="hint" style={{ color: '#ef4444', marginTop: 8 }}>
                  🔒 Locked{selected.locked_reason ? `: ${selected.locked_reason}` : ''} — deploys to this
                  channel are blocked (admins can override).
                </p>
              )}
            </div>

            <h4>Variables & secrets</h4>
            <table className="grid">
              <thead><tr><th>Scope</th><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id}>
                    <td>{v.product_name || <span style={{ color: 'var(--muted)' }}>global</span>}</td>
                    <td><code>{v.key}</code></td>
                    <td>{v.is_secret ? <span style={{ color: 'var(--muted)' }}>●●●●●●●● (secret)</span> : v.value}</td>
                    <td><button style={{ background: '#f87171' }} onClick={() => removeVar(v)}>Remove</button></td>
                  </tr>
                ))}
                {vars.length === 0 && <tr><td colSpan="4" className="empty">No variables set.</td></tr>}
              </tbody>
            </table>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); saveVar(); }}>
              <input placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} style={{ width: 160 }} />
              <input placeholder="value" type={form.is_secret ? 'password' : 'text'} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ width: 200 }} />
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">— global (all products) —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={form.is_secret} onChange={(e) => setForm({ ...form, is_secret: e.target.checked })} />
                secret
              </label>
              <button type="submit">Save</button>
            </form>
          </div>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>Compare two channels</h3>
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
          <option value="">— channel A —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
          <option value="">— channel B —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={runCompare}>Compare</button>
      </div>
      {diff && (
        <table className="grid">
          <thead><tr><th>Key</th><th>Scope</th><th>In A</th><th>In B</th><th>Match</th></tr></thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.scope}>
                <td><code>{d.key}</code>{d.is_secret && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>secret</span>}</td>
                <td>{d.product_id ? 'product' : 'global'}</td>
                <td>{d.in_a ? '✓' : '—'}</td>
                <td>{d.in_b ? '✓' : '—'}</td>
                <td>{d.equal === null ? <span style={{ color: 'var(--muted)' }}>n/a</span> : d.equal ? <span style={{ color: '#22c55e' }}>same</span> : <span style={{ color: '#eab308' }}>differs</span>}</td>
              </tr>
            ))}
            {diff.length === 0 && <tr><td colSpan="5" className="empty">No variables on either channel.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
