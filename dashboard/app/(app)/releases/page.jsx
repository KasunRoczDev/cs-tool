'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const CHANNEL_COLORS = {
  draft: '#94a3b8', canary: '#eab308', beta: '#3b82f6',
  production: '#22c55e', enterprise: '#a855f7', archived: '#64748b',
};

export function ChannelBadge({ status }) {
  return (
    <span style={{
      background: CHANNEL_COLORS[status] || '#64748b', color: '#fff',
      padding: '2px 8px', borderRadius: 12, fontSize: 12, textTransform: 'capitalize',
    }}>{status}</span>
  );
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ version: '', name: '' });

  const load = () => api.releases().then(setReleases).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.createRelease(form);
      setForm({ version: '', name: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🚀 Releases</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="version (e.g. 1.7.0)" required value={form.version}
          onChange={(e) => setForm({ ...form, version: e.target.value })} />
        <input placeholder="name (optional)" style={{ minWidth: 200 }} value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button type="submit">Draft release</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Version</th><th>Name</th><th>Status</th><th>Repos</th><th>Items</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r.id}>
              <td><b>{r.version}</b></td>
              <td>{r.name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td><ChannelBadge status={r.status} /></td>
              <td>{r.repo_count}</td>
              <td>{r.item_count}</td>
              <td>{new Date(r.created_at).toLocaleDateString()}</td>
              <td><Link href={`/releases/${r.id}`}><button>Open</button></Link></td>
            </tr>
          ))}
          {releases.length === 0 && <tr><td colSpan="7" className="empty">No releases yet.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 16 }}>
        A release is a pinned bundle of repositories at exact commits plus the features/bugs/hotfixes
        it ships. Draft → Canary → Beta → Production → Enterprise; each promotion is approval-gated and
        moves the same pinned artifact forward.
      </p>
    </div>
  );
}
