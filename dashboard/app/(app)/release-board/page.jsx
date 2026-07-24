'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function ReleaseBoardPage() {
  const router = useRouter();
  const [columns, setColumns] = useState([]);
  const [err, setErr] = useState('');

  const load = () => api.releaseBoard().then(setColumns).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-head"><h2>🗂️ Release Status Board</h2></div>
      {err && <div className="error">{err}</div>}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
        {columns.map((col) => (
          <div key={col.key} style={{ flex: '0 0 240px', minWidth: 240 }}>
            <div style={{
              fontWeight: 700, padding: '8px 10px', borderRadius: 8, marginBottom: 8,
              borderLeft: `4px solid ${col.color || 'var(--border)'}`, background: 'var(--panel-2)',
            }}>
              {col.name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>· {col.releases.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.releases.map((r) => (
                <div key={r.id} onClick={() => router.push(`/releases/${r.id}`)} style={{
                  cursor: 'pointer', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)',
                }}>
                  <b>🚀 {r.version}</b>
                  {r.name && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.name}</div>}
                </div>
              ))}
              {col.releases.length === 0 && <div className="empty" style={{ padding: 12, fontSize: 12 }}>—</div>}
            </div>
          </div>
        ))}
        {columns.length === 0 && <p className="empty">No releases yet.</p>}
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Columns come from the configurable release workflow. Status changes are permission-gated
        (<code>status.transition.&lt;status&gt;</code>) and approval-gated; open a release to transition it.
      </p>
    </div>
  );
}
