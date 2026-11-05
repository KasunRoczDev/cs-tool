'use client';
import PageHeader from '@/components/PageHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import { getPageContext } from '@/lib/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function ReleaseBoardPage() {
  const router = useRouter();
  const [columns, setColumns] = useState([]);
  const [err, setErr] = useState('');

  const [loadState, setLoadState] = useState({ pending: true, error: '' });
  const loadRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoadState({ pending: true, error: '' });
    try {
      const result = await api.releaseBoard();
      if (request === loadRequest.current) { setColumns(result); setLoadState({ pending: false, error: '' }); }
    } catch (e) {
      if (request === loadRequest.current) setLoadState({ pending: false, error: e.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title={getPageContext("/release-board").title} description={getPageContext("/release-board").description} />
      {loadState.pending && <FeedbackState kind="loading" title="Loading release board…" compact />}
      {loadState.error && <FeedbackState kind="error" title="Unable to load release board" description={loadState.error} action={<button onClick={load}>Retry</button>} />}
      {err && <FeedbackState kind="error" title="Request failed" description={err} />}
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
        {!loadState.pending && !loadState.error && columns.length === 0 && <p className="empty">No releases yet.</p>}
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Columns come from the configurable release workflow. Status changes are permission-gated
        (<code>status.transition.&lt;status&gt;</code>) and approval-gated; open a release to transition it.
      </p>
    </div>
  );
}
