'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

const STATUS_COLORS = {
  pending: '#eab308', approved: '#3b82f6', in_progress: '#06b6d4',
  succeeded: '#22c55e', failed: '#ef4444', rolled_back: '#a855f7', cancelled: '#64748b',
};

function StatusBadge({ status }) {
  if (!status) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{
      background: STATUS_COLORS[status] || '#64748b', color: '#fff',
      padding: '2px 8px', borderRadius: 12, fontSize: 12,
    }}>{status.replace('_', ' ')}</span>
  );
}

export default function DeploymentsPage() {
  const [board, setBoard] = useState([]);
  const [deps, setDeps] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const [jobsFor, setJobsFor] = useState(null);
  const [jobs, setJobs] = useState([]);

  const load = () => {
    api.deploymentBoard().then(setBoard).catch((e) => setErr(e.message));
    api.deployments().then(setDeps).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    const s = getSocket();
    if (!s) return;
    const onEvt = () => load();
    s.on('release_event', onEvt);
    return () => s.off('release_event', onEvt);
  }, []);

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) setMsg(m); load(); } catch (e) { setErr(e.message); }
  };

  const showHistory = async (d) => {
    if (historyFor === d.id) { setHistoryFor(null); return; }
    setHistoryFor(d.id);
    try { setHistory(await api.deploymentHistory(d.id)); } catch (e) { setErr(e.message); }
  };

  const showJobs = async (d) => {
    if (jobsFor === d.id) { setJobsFor(null); return; }
    setJobsFor(d.id);
    try { setJobs(await api.deploymentJobs(d.id)); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🛳️ Deployments</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}

      {/* Channel pipeline board */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        {board.map(({ channel, current, latest }) => (
          <div key={channel.id} style={{
            flex: '1 0 200px', border: '1px solid var(--border,#3334)', borderRadius: 10, padding: 14,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{channel.name}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>current</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{current?.release_version || '—'}</div>
            {current?.previous_version && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>prev {current.previous_version} · rollback → {current.rollback_target}</div>
            )}
            <div style={{ marginTop: 8 }}>
              latest: <StatusBadge status={latest?.status} />
              {latest && <span style={{ marginLeft: 6, fontSize: 12 }}>{latest.release_version}</span>}
            </div>
            {latest?.status === 'pending' && (
              <button style={{ marginTop: 8 }} onClick={() => guard(() => api.approveDeployment(latest.id), 'Approved & deployed')}>Approve</button>
            )}
            {latest?.status === 'succeeded' && latest.rollback_target && (
              <button style={{ marginTop: 8, background: '#a855f7' }} onClick={() => guard(() => api.rollbackDeployment(latest.id), `Rolled back to ${latest.rollback_target}`)}>Rollback</button>
            )}
          </div>
        ))}
        {board.length === 0 && <p className="empty">No channels.</p>}
      </div>

      {/* Deployment history */}
      <h3 style={{ marginTop: 24 }}>History</h3>
      <table className="grid">
        <thead><tr><th>Release</th><th>Channel</th><th>Status</th><th>Version</th><th>Rollback target</th><th>By</th><th>When</th><th></th></tr></thead>
        <tbody>
          {deps.map((d) => (
            <>
              <tr key={d.id}>
                <td><b>{d.release_version}</b></td>
                <td>{d.channel_name}</td>
                <td><StatusBadge status={d.status} /></td>
                <td>{d.current_version}</td>
                <td>{d.rollback_target || '—'}</td>
                <td>{d.triggered_by_email || '—'}</td>
                <td>{new Date(d.created_at).toLocaleString()}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {d.status === 'pending' && <button onClick={() => guard(() => api.approveDeployment(d.id), 'Approved')}>Approve</button>}
                  {['pending', 'approved', 'in_progress'].includes(d.status) && (
                    <button style={{ background: '#64748b' }} onClick={() => guard(() => api.cancelDeployment(d.id), 'Cancelled')}>Cancel</button>
                  )}
                  {d.status === 'failed' && <button style={{ background: '#f59e0b' }} onClick={() => guard(() => api.retryDeployment(d.id), 'Retrying')}>Retry</button>}
                  {d.status === 'succeeded' && d.rollback_target && <button style={{ background: '#a855f7' }} onClick={() => guard(() => api.rollbackDeployment(d.id), 'Rolled back')}>Rollback</button>}
                  <button onClick={() => showJobs(d)}>Pipeline</button>
                  <button onClick={() => showHistory(d)}>Log</button>
                </td>
              </tr>
              {jobsFor === d.id && (
                <tr key={d.id + '-j'}>
                  <td colSpan="8" style={{ background: 'var(--panel,#0001)' }}>
                    {jobs.length === 0 ? (
                      <span className="empty">No agent jobs — this deployment is tracking-only (no servers selected).</span>
                    ) : (
                      <table className="grid" style={{ margin: 0 }}>
                        <thead><tr><th>Server</th><th>Repo</th><th>Env</th><th>Branch</th><th>Status</th><th>Pipeline</th></tr></thead>
                        <tbody>
                          {jobs.map((j) => (
                            <tr key={j.id}>
                              <td><b>{j.server_name}</b></td>
                              <td>{j.repo_slug}</td>
                              <td>{j.env_path}</td>
                              <td>{j.branch || '—'}</td>
                              <td><StatusBadge status={j.status} />{j.error && <div style={{ color: 'var(--crit)', fontSize: 11 }}>{j.error}</div>}</td>
                              <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {(j.steps || []).map((s) => (
                                  <span key={s.name} title={s.status} style={{
                                    fontSize: 11, padding: '1px 6px', borderRadius: 6,
                                    background: s.status === 'succeeded' ? '#16331f' : s.status === 'fail' ? '#3a1620' : '#2a2f3a',
                                    color: s.status === 'succeeded' ? '#22c55e' : s.status === 'fail' ? '#ef4444' : '#94a3b8',
                                  }}>{s.name}</span>
                                ))}
                                {(!j.steps || j.steps.length === 0) && <span className="muted" style={{ fontSize: 12 }}>—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
              {historyFor === d.id && (
                <tr key={d.id + '-h'}>
                  <td colSpan="8" style={{ background: 'var(--panel,#0001)' }}>
                    {history.length === 0 ? <span className="empty">No transitions.</span> : (
                      <ul style={{ margin: 0 }}>
                        {history.map((h) => (
                          <li key={h.id}>{new Date(h.occurred_at).toLocaleString()} — {h.from_status ? `${h.from_status} → ` : ''}<b>{h.to_status}</b>{h.note ? ` (${h.note})` : ''}{h.actor_email ? ` · ${h.actor_email}` : ''}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
          {deps.length === 0 && <tr><td colSpan="8" className="empty">No deployments yet. Deploy a release from its detail page.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 16 }}>
        Each channel shows its current version, previous version and pre-computed rollback target.
        Approval-gated channels stay <i>pending</i> until approved; rollback re-promotes the prior
        pinned artifact in one click (no rebuild). When servers are selected, the on-server agents
        run the pipeline and report per-step status under <b>Pipeline</b>; with no servers it is tracking-only.
        A job stuck with an unresponsive agent auto-fails after 15 minutes. Cancel stops a
        deployment in flight; Retry re-runs only the jobs that failed (not the whole deployment).
      </p>
    </div>
  );
}
