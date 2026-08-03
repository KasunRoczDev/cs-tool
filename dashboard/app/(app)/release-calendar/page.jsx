'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const DEP_COLORS = {
  scheduled: '#8b5cf6', pending: '#eab308', approved: '#3b82f6', in_progress: '#06b6d4',
  succeeded: '#22c55e', failed: '#ef4444', rolled_back: '#a855f7', cancelled: '#64748b',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export default function ReleaseCalendarPage() {
  const router = useRouter();
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [data, setData] = useState({ releases: [], deployments: [], freeze_windows: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [me, setMe] = useState(null);
  const [channels, setChannels] = useState([]);
  const [products, setProducts] = useState([]);
  const [showFreezeForm, setShowFreezeForm] = useState(false);
  const [freezeForm, setFreezeForm] = useState({ name: '', starts_at: '', ends_at: '', channel_id: '', product_id: '', reason: '' });

  const from = toISODate(startOfMonth(monthDate));
  const to = toISODate(endOfMonth(monthDate));

  const load = () => api.releaseCalendar(from, to).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [from, to]);
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    api.channels().then(setChannels).catch(() => {});
    api.products().then(setProducts).catch(() => {});
  }, []);

  const isAdmin = me?.role === 'admin';

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) setMsg(m); load(); } catch (e) { setErr(e.message); }
  };

  const createFreeze = () => guard(async () => {
    if (!freezeForm.name || !freezeForm.starts_at || !freezeForm.ends_at) return setErr('Name, start and end are required');
    await api.createFreezeWindow({
      ...freezeForm,
      starts_at: new Date(freezeForm.starts_at).toISOString(),
      ends_at: new Date(freezeForm.ends_at).toISOString(),
      channel_id: freezeForm.channel_id || undefined,
      product_id: freezeForm.product_id || undefined,
    });
    setFreezeForm({ name: '', starts_at: '', ends_at: '', channel_id: '', product_id: '', reason: '' });
    setShowFreezeForm(false);
  }, 'Freeze window created');

  const deleteFreeze = (fw) => guard(async () => {
    if (!confirm(`Delete freeze window "${fw.name}"?`)) return;
    await api.deleteFreezeWindow(fw.id);
  }, 'Freeze window deleted');

  const days = useMemo(() => {
    const first = startOfMonth(monthDate);
    const last = endOfMonth(monthDate);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), d));
    return cells;
  }, [monthDate]);

  const byDay = useMemo(() => {
    const m = new Map();
    const add = (iso, kind, item) => {
      if (!m.has(iso)) m.set(iso, { releases: [], deployments: [], freezes: [] });
      m.get(iso)[kind].push(item);
    };
    for (const r of data.releases) {
      if (r.planned_date) add(toISODate(new Date(r.planned_date)), 'releases', r);
    }
    for (const d of data.deployments) {
      const at = d.scheduled_at || d.finished_at || d.created_at;
      if (at) add(toISODate(new Date(at)), 'deployments', d);
    }
    for (const cell of days) {
      if (!cell) continue;
      const iso = toISODate(cell);
      const dayStart = new Date(cell); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(cell); dayEnd.setHours(23, 59, 59, 999);
      for (const fw of data.freeze_windows) {
        if (new Date(fw.starts_at) <= dayEnd && new Date(fw.ends_at) >= dayStart) add(iso, 'freezes', fw);
      }
    }
    return m;
  }, [data, days]);

  return (
    <div>
      <div className="page-head"><h2>📅 Release Calendar</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={() => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>◀</button>
        <b style={{ minWidth: 160, textAlign: 'center' }}>{monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <button onClick={() => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>▶</button>
        <button onClick={() => setMonthDate(startOfMonth(new Date()))}>Today</button>
        {isAdmin && (
          <button style={{ marginLeft: 'auto' }} onClick={() => setShowFreezeForm((s) => !s)}>
            {showFreezeForm ? 'Cancel' : '🚫 New freeze window'}
          </button>
        )}
      </div>

      {showFreezeForm && (
        <form className="inline-form" style={{ marginBottom: 16, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); createFreeze(); }}>
          <input placeholder="name (e.g. Holiday freeze)" value={freezeForm.name}
            onChange={(e) => setFreezeForm({ ...freezeForm, name: e.target.value })} style={{ minWidth: 180 }} />
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>from
            <input type="datetime-local" value={freezeForm.starts_at}
              onChange={(e) => setFreezeForm({ ...freezeForm, starts_at: e.target.value })} style={{ display: 'block' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>to
            <input type="datetime-local" value={freezeForm.ends_at}
              onChange={(e) => setFreezeForm({ ...freezeForm, ends_at: e.target.value })} style={{ display: 'block' }} />
          </label>
          <select value={freezeForm.channel_id} onChange={(e) => setFreezeForm({ ...freezeForm, channel_id: e.target.value })}>
            <option value="">— all channels —</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={freezeForm.product_id} onChange={(e) => setFreezeForm({ ...freezeForm, product_id: e.target.value })}>
            <option value="">— all products —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="reason (optional)" value={freezeForm.reason}
            onChange={(e) => setFreezeForm({ ...freezeForm, reason: e.target.value })} style={{ minWidth: 160 }} />
          <button type="submit">Create</button>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', fontWeight: 700, padding: 4 }}>{w}</div>
        ))}
        {days.map((cell, i) => {
          if (!cell) return <div key={`b${i}`} />;
          const iso = toISODate(cell);
          const info = byDay.get(iso) || { releases: [], deployments: [], freezes: [] };
          const isToday = iso === toISODate(new Date());
          return (
            <div key={iso} style={{
              minHeight: 92, borderRadius: 8, padding: 6,
              border: `1px solid ${isToday ? 'var(--accent, #4f9dff)' : 'var(--border)'}`,
              background: info.freezes.length ? 'rgba(239,68,68,.08)' : 'var(--panel)',
            }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent, #4f9dff)' : 'var(--muted)' }}>
                {cell.getDate()}
              </div>
              {info.freezes.map((fw) => (
                <div key={fw.id} title={fw.reason || fw.name} style={{
                  fontSize: 10, color: '#ef4444', fontWeight: 700, marginTop: 2,
                  display: 'flex', justifyContent: 'space-between', gap: 4,
                }}>
                  <span>🚫 {fw.name}</span>
                  {isAdmin && <span style={{ cursor: 'pointer' }} onClick={() => deleteFreeze(fw)}>✕</span>}
                </div>
              ))}
              {info.releases.map((r) => (
                <div key={r.id} title={r.name || r.version} onClick={() => router.push(`/releases/${r.id}`)} style={{
                  fontSize: 11, marginTop: 2, cursor: 'pointer', color: '#eab308',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>📦 {r.version}</div>
              ))}
              {info.deployments.map((d) => (
                <div key={d.id} title={`${d.release_version} → ${d.channel_name} (${d.status})`} style={{
                  fontSize: 11, marginTop: 2, color: DEP_COLORS[d.status] || '#64748b',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>🛳️ {d.release_version} · {d.channel_name}</div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        📦 planned release dates · 🛳️ deployments (scheduled, or by their finish/creation date) ·
        🚫 freeze windows (deploys blocked during these; admins can override). Click a release
        chip to open it.
      </p>
    </div>
  );
}
