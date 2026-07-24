'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getRole } from '@/lib/api';

/**
 * Branch management for a repository: list, create, delete, compare, detect
 * merge conflicts, and view branch history. GitHub-backed (needs a repo token).
 * Rendered as a modal overlay, mirroring the GitGraph component's pattern.
 */
export default function BranchManager({ repo, onClose }) {
  const canWrite = ['admin', 'operator'].includes(getRole());
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // create
  const [newBranch, setNewBranch] = useState({ name: '', from: repo.default_branch || 'main' });
  // compare / conflicts
  const [cmp, setCmp] = useState({ base: repo.default_branch || 'main', head: '' });
  const [cmpResult, setCmpResult] = useState(null);
  const [conflict, setConflict] = useState(null);
  // history
  const [historyBranch, setHistoryBranch] = useState('');
  const [history, setHistory] = useState(null);

  const load = () => {
    setErr('');
    api.repoBranches(repo.id).then(setBranches).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [repo.id]);

  const create = async (e) => {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      await api.createBranch(repo.id, { name: newBranch.name, from: newBranch.from || undefined });
      setMsg(`Created ${newBranch.name} from ${newBranch.from || 'default'}.`);
      setNewBranch({ name: '', from: repo.default_branch || 'main' });
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const del = async (name) => {
    if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
    setErr(''); setMsg(''); setBusy(true);
    try { await api.deleteBranch(repo.id, name); setMsg(`Deleted ${name}.`); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const compare = async () => {
    setErr(''); setCmpResult(null); setConflict(null); setBusy(true);
    try { setCmpResult(await api.compareBranches(repo.id, cmp.base, cmp.head)); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const checkConflicts = async () => {
    setErr(''); setConflict(null); setBusy(true);
    try { setConflict(await api.branchConflicts(repo.id, cmp.base, cmp.head)); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const loadHistory = async (branch) => {
    setErr(''); setHistory(null); setHistoryBranch(branch); setBusy(true);
    try { setHistory(await api.branchHistory(repo.id, branch, 30)); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="modal-head">
          <h3>🌿 Branches — {repo.name}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        {!repo.has_token && (
          <div className="hint">This repo has no GitHub token set. Branch operations require one.</div>
        )}
        {err && <div className="error">{err}</div>}
        {msg && <div className="hint">{msg}</div>}

        {/* Create */}
        {canWrite && (
          <form className="inline-form" onSubmit={create} style={{ marginBottom: 12 }}>
            <input placeholder="new branch (feature/x)" required value={newBranch.name}
              onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} />
            <input placeholder="from ref" style={{ width: 140 }} value={newBranch.from}
              onChange={(e) => setNewBranch({ ...newBranch, from: e.target.value })} />
            <button type="submit" disabled={busy}>Create branch</button>
          </form>
        )}

        {/* Branch list */}
        <div className="branch-list">
          {branches.length === 0 ? <span className="empty">No branches loaded.</span> : (
            <table className="grid">
              <thead><tr><th>Branch</th><th>Tip</th><th></th></tr></thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.name}>
                    <td>
                      {b.protected && <span title="protected">🔒 </span>}
                      <b>{b.name}</b>
                    </td>
                    <td><code>{String(b.commit_sha).slice(0, 8)}</code></td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => loadHistory(b.name)}>History</button>
                      <button onClick={() => setCmp((c) => ({ ...c, head: b.name }))}>Use as head</button>
                      <button onClick={() => setCmp((c) => ({ ...c, base: b.name }))}>Use as base</button>
                      {canWrite && b.name !== repo.default_branch &&
                        <button onClick={() => del(b.name)} style={{ background: '#f87171' }}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Compare + conflicts */}
        <div className="branch-compare">
          <h4>Compare &amp; conflict check</h4>
          <div className="inline-form">
            <input placeholder="base" style={{ width: 150 }} value={cmp.base}
              onChange={(e) => setCmp({ ...cmp, base: e.target.value })} />
            <span style={{ alignSelf: 'center' }}>…</span>
            <input placeholder="head" style={{ width: 150 }} value={cmp.head}
              onChange={(e) => setCmp({ ...cmp, head: e.target.value })} />
            <button onClick={compare} disabled={busy || !cmp.base || !cmp.head}>Compare</button>
            <button onClick={checkConflicts} disabled={busy || !cmp.base || !cmp.head}>Detect conflicts</button>
          </div>

          {cmpResult && (
            <div className="cmp-result">
              <p>
                <b>{cmp.head}</b> vs <b>{cmp.base}</b>: status <b>{cmpResult.status}</b> ·
                {' '}↑{cmpResult.ahead_by} ahead · ↓{cmpResult.behind_by} behind ·
                {' '}{cmpResult.total_commits} commits · {cmpResult.files.length} files
              </p>
              {cmpResult.files.length > 0 && (
                <ul className="file-list">
                  {cmpResult.files.slice(0, 50).map((f) => (
                    <li key={f.filename}>
                      <span className={`fstat fstat-${f.status}`}>{f.status[0].toUpperCase()}</span>
                      <code>{f.filename}</code>
                      <span className="muted"> +{f.additions} −{f.deletions}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {conflict && (
            <div className={`conflict-banner ${conflict.conflicts ? 'bad' : 'ok'}`}>
              {conflict.conflicts
                ? <>⚠️ <b>Merge conflicts</b> — {cmp.head} does not merge cleanly into {cmp.base}.</>
                : <>✅ <b>No conflicts</b> — {cmp.head} merges cleanly into {cmp.base}.</>}
              <span className="muted"> (status {conflict.status}, ↑{conflict.ahead_by} ↓{conflict.behind_by})</span>
            </div>
          )}
        </div>

        {/* History */}
        {history && (
          <div className="branch-history">
            <h4>History — {historyBranch} <span className="muted">(latest {history.length})</span></h4>
            <ul className="commit-list">
              {history.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha.slice(0, 8)}</code> {c.message}
                  <span className="muted"> — {c.author}{c.date ? `, ${new Date(c.date).toLocaleDateString()}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
