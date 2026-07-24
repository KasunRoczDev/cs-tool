'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ChannelBadge } from '../page';
import ServerMultiSelect from '@/components/ServerMultiSelect';

export default function ReleaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [rel, setRel] = useState(null);
  const [repos, setRepos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [repoForm, setRepoForm] = useState({ repository_id: '', ref: 'main', repo_version: '' });
  const [itemForm, setItemForm] = useState({ item_type: 'feature', item_key: '', title: '', author: '' });
  const [servers, setServers] = useState([]);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showAllServers, setShowAllServers] = useState(false);
  const [deployForm, setDeployForm] = useState({
    channel: 'canary', server_ids: [], branch: '', custom_commands: '',
  });

  const [me, setMe] = useState(null);
  const [approvals, setApprovals] = useState(null);
  const [approveForm, setApproveForm] = useState({ remark: '', file: null });

  const [status, setStatus] = useState(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);

  const load = () => api.release(id).then(setRel).catch((e) => setErr(e.message));
  const loadApprovals = () => api.releaseApprovals(id).then(setApprovals).catch(() => {});
  const loadStatus = () => api.releaseStatus(id).then(setStatus).catch(() => {});
  useEffect(() => {
    load();
    loadApprovals();
    loadStatus();
    api.me().then(setMe).catch(() => {});
    api.repositories().then(setRepos).catch(() => {});
    api.channels().then(setChannels).catch(() => {});
    api.servers().then(setServers).catch(() => {});
  }, [id]);

  const toggleHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    try { setStatusHistory(await api.releaseStatusHistory(id)); } catch (e) { setErr(e.message); }
  };

  const doTransition = (toKey) => guard(async () => {
    await api.transitionRelease(id, toKey, transitionNote || undefined);
    setTransitionNote('');
    loadStatus();
    if (showHistory) setStatusHistory(await api.releaseStatusHistory(id));
    setMsg(`Moved to ${toKey}`);
  });

  const submitApproval = async (decision) => {
    setErr(''); setMsg('');
    try {
      const fd = new FormData();
      fd.append('decision', decision);
      if (approveForm.remark) fd.append('remark', approveForm.remark);
      if (approveForm.file) fd.append('file', approveForm.file);
      await api.submitApproval(id, fd);
      setApproveForm({ remark: '', file: null });
      setMsg(`Recorded your ${decision}.`);
      loadApprovals();
    } catch (e) { setErr(e.message); }
  };

  const submitDeploy = () => guard(async () => {
    await api.deployRelease(id, {
      channel: deployForm.channel,
      server_ids: deployForm.server_ids,
      branch: deployForm.branch || undefined,
      custom_commands: deployForm.custom_commands
        ? deployForm.custom_commands.split('\n').map((s) => s.trim()).filter(Boolean)
        : undefined,
    });
    setShowDeploy(false);
    setMsg(
      deployForm.server_ids.length
        ? `Deployment to ${deployForm.channel} created on ${deployForm.server_ids.length} server(s) — approve it on the Deployments board to start the agents`
        : `Deployment to ${deployForm.channel} created — approve it on the Deployments board`,
    );
    router.push('/deployments');
  });

  const guard = async (fn) => {
    setErr(''); setMsg('');
    try { await fn(); load(); } catch (e) { setErr(e.message); }
  };

  if (!rel) return <div>{err ? <div className="error">{err}</div> : 'Loading…'}</div>;

  const isDraft = rel.status === 'draft';

  // Servers relevant to this release = servers whose product matches one of the
  // products of the release's pinned repositories.
  const releaseProductIds = new Set(
    (rel.repositories || []).map((r) => r.product_id).filter(Boolean),
  );
  const hasProductScope = releaseProductIds.size > 0;
  const serverChoices = (!hasProductScope || showAllServers)
    ? servers
    : servers.filter((s) => releaseProductIds.has(s.product_id));

  // Approval gate
  const isAdmin = me?.role === 'admin';
  const myApproval = approvals?.approvers?.find((a) => a.approver_id === me?.sub) || null;
  const fullyApproved = !approvals || approvals.fully_approved;
  const canDeploy = fullyApproved || isAdmin;
  const gateTitle = canDeploy ? '' : 'Blocked: all required approvers must sign off (admin can override)';

  return (
    <div>
      <div className="page-head">
        <h2>🚀 {rel.version} {rel.name && <span style={{ color: 'var(--muted)' }}>— {rel.name}</span>}</h2>
        <ChannelBadge status={rel.status} />
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <button onClick={() => guard(async () => { await api.generateReleaseNotes(id); setMsg('Release notes generated'); })}>
          Generate release notes
        </button>
        {rel.status !== 'archived' && (
          <button style={{ background: '#64748b' }} onClick={() => guard(() => api.archiveRelease(id))}>Archive</button>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => setShowDeploy(true)} disabled={rel.status === 'archived' || !canDeploy}
            title={gateTitle}>Deploy…</button>
        </div>
      </div>

      {/* ── Status workflow ── */}
      <h3 style={{ marginTop: 8 }}>🧭 Status
        {status?.workflow && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>({status.workflow})</span>}
      </h3>
      {status && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Current:</span>
            <ChannelBadge status={status.current?.key || rel.status} />
            <button style={{ marginLeft: 'auto', fontSize: 12 }} onClick={toggleHistory}>
              {showHistory ? 'Hide history' : 'View history'}
            </button>
          </div>
          {status.transitions.length > 0 ? (
            <>
              <input placeholder="Note (optional)" value={transitionNote}
                onChange={(e) => setTransitionNote(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {status.transitions.map((t) => (
                  <button key={t.to_status_key} disabled={!t.allowed}
                    title={t.allowed ? (t.require_approval ? 'Requires full approval sign-off (admin can override)' : '') : 'Missing permission for this transition'}
                    onClick={() => doTransition(t.to_status_key)}>
                    {t.kind === 'archive' ? 'Archive' : `Move → ${t.to_status_name}`}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="empty">No further transitions from this status.</p>
          )}
          {showHistory && (
            statusHistory.length === 0 ? <p className="empty" style={{ marginTop: 10 }}>No transitions yet.</p> : (
              <ul style={{ marginTop: 10 }}>
                {statusHistory.map((h) => (
                  <li key={h.id}>{new Date(h.created_at).toLocaleString()} — {h.from_name ? `${h.from_name} → ` : ''}<b>{h.to_name}</b>{h.note ? ` (${h.note})` : ''}{h.actor_email ? ` · ${h.actor_email}` : ''}</li>
                ))}
              </ul>
            )
          )}
        </div>
      )}

      {/* ── Approvals ── */}
      <h3 style={{ marginTop: 8 }}>✅ Approvals
        {approvals && (
          <span style={{
            marginLeft: 10, fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999,
            background: approvals.fully_approved ? 'rgba(34,197,94,.15)' : approvals.rejected ? 'rgba(239,68,68,.15)' : 'var(--panel-2)',
            color: approvals.fully_approved ? '#22c55e' : approvals.rejected ? '#ef4444' : 'var(--muted)',
            border: '1px solid var(--border)',
          }}>
            {approvals.fully_approved ? 'Fully approved' : approvals.rejected ? 'Rejected' : `${approvals.approved_count}/${approvals.required_count} approved`}
          </span>
        )}
      </h3>
      {approvals && approvals.required_count === 0 && (
        <p className="hint">No approvers configured for this release&apos;s product. Assign approval roles + products to users on the Users page.</p>
      )}
      {approvals && approvals.required_count > 0 && (
        <table className="grid">
          <thead><tr><th>Role</th><th>Approver</th><th>Decision</th><th>Remark</th><th>Attachments</th><th>When</th></tr></thead>
          <tbody>
            {approvals.approvers.map((a) => (
              <tr key={a.approver_id}>
                <td><b>{a.role_label}</b></td>
                <td>{a.email}</td>
                <td>
                  <span style={{ fontWeight: 700, color: a.decision === 'approved' ? '#22c55e' : a.decision === 'rejected' ? '#ef4444' : 'var(--muted)' }}>
                    {a.decision}
                  </span>
                </td>
                <td style={{ fontSize: 13 }}>{a.remark || '—'}</td>
                <td>
                  {(a.attachments || []).length === 0 ? '—' : a.attachments.map((att) => (
                    <button key={att.id} onClick={() => api.downloadApprovalAttachment(att.id, att.filename)}
                      style={{ fontSize: 11, marginRight: 4 }}>📎 {att.filename}</button>
                  ))}
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{a.decided_at ? new Date(a.decided_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {myApproval && (
        <div className="card" style={{ marginTop: 10 }}>
          <h4 style={{ marginTop: 0 }}>Your sign-off ({myApproval.role_label})
            {myApproval.decision !== 'pending' && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — current: {myApproval.decision} (you can update)</span>}
          </h4>
          <textarea rows={2} placeholder="Remark (optional)" value={approveForm.remark}
            onChange={(e) => setApproveForm({ ...approveForm, remark: e.target.value })}
            style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" onChange={(e) => setApproveForm({ ...approveForm, file: e.target.files?.[0] || null })} />
            <button style={{ background: '#22c55e' }} onClick={() => submitApproval('approved')}>Approve</button>
            <button style={{ background: '#ef4444' }} onClick={() => submitApproval('rejected')}>Reject</button>
          </div>
        </div>
      )}
      {!canDeploy && (
        <p className="hint" style={{ color: '#eab308' }}>
          ⚠ Deploy &amp; promote are blocked until all required approvers sign off{isAdmin ? '' : ' (an admin can override)'}.
        </p>
      )}

      {/* Deploy modal: channel + target servers + branch + custom commands */}
      {showDeploy && (
        <div className="modal-overlay" onClick={() => setShowDeploy(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>🚀 Deploy {rel.version}</h3>
              <button className="x" onClick={() => setShowDeploy(false)}>✕</button>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }}>
              Environment
              <select value={deployForm.channel} onChange={(e) => setDeployForm({ ...deployForm, channel: e.target.value })}>
                {channels.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}
              </select>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Target servers <span style={{ opacity: 0.7 }}>— the agent on each runs the pipeline</span>
              </div>
              {hasProductScope && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAllServers}
                    onChange={(e) => setShowAllServers(e.target.checked)} />
                  Show all servers
                </label>
              )}
            </div>
            {hasProductScope && !showAllServers && (
              <div className="hint" style={{ marginBottom: 6, fontSize: 12 }}>
                Showing only servers for this release&apos;s product
                {rel.repositories.find((r) => r.product_name) ? ` (${[...new Set(rel.repositories.map((r) => r.product_name).filter(Boolean))].join(', ')})` : ''}.
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <ServerMultiSelect
                servers={serverChoices}
                selected={deployForm.server_ids}
                onChange={(ids) => setDeployForm((f) => ({ ...f, server_ids: ids }))}
              />
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }}>
              Branch (optional — overrides each repo's pinned branch)
              <input value={deployForm.branch} placeholder="leave empty = pinned/current branch"
                onChange={(e) => setDeployForm({ ...deployForm, branch: e.target.value })} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 4 }}>
              Custom commands (one per line, run after the pipeline)
              <textarea rows={3} value={deployForm.custom_commands} style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder={'php artisan db:seed --force\nphp artisan cache:clear\nsystemctl restart oms-worker'}
                onChange={(e) => setDeployForm({ ...deployForm, custom_commands: e.target.value })} />
            </label>
            <div className="hint" style={{ fontSize: 12, marginBottom: 12 }}>
              Migrations run automatically (<code>artisan migrate --force</code> for Laravel repos) — no need to add
              them here. <strong>Seeders and any extra cache clears are NOT automatic</strong>; add them above, e.g.{' '}
              <code>php artisan db:seed --force</code> or <code>php artisan cache:clear</code>.
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Pipeline per repo: fetch → checkout → install → build → migrate (<code>artisan migrate --force</code>,
              Laravel only) → restart (<code>config:cache</code>, <code>queue:restart</code>, service reload) →
              health check → custom commands.
              {deployForm.server_ids.length === 0 && ' No servers selected → tracking-only (no agent execution).'}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submitDeploy}>Create deployment</button>
              <button style={{ background: 'transparent', border: '1px solid var(--border)' }} onClick={() => setShowDeploy(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Pinned repositories */}
      <h3>📦 Pinned repositories</h3>
      <table className="grid">
        <thead><tr><th>Repository</th><th>Version</th><th>Commit</th><th>Branch</th>{isDraft && <th></th>}</tr></thead>
        <tbody>
          {rel.repositories.map((r) => (
            <tr key={r.id}>
              <td><b>{r.repository_name}</b> <span style={{ color: 'var(--muted)' }}>{r.repository_slug}</span></td>
              <td>{r.repo_version || '—'}</td>
              <td><code>{String(r.commit_sha).slice(0, 10)}</code></td>
              <td>{r.branch_name || '—'}</td>
              {isDraft && <td><button style={{ background: '#f87171' }} onClick={() => guard(() => api.removeReleaseRepo(id, r.id))}>Remove</button></td>}
            </tr>
          ))}
          {rel.repositories.length === 0 && <tr><td colSpan={isDraft ? 5 : 4} className="empty">No repositories pinned.</td></tr>}
        </tbody>
      </table>
      {isDraft && (
        <form className="inline-form" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); guard(async () => { await api.addReleaseRepo(id, repoForm); setRepoForm({ repository_id: '', ref: 'main', repo_version: '' }); }); }}>
          <select required value={repoForm.repository_id} onChange={(e) => setRepoForm({ ...repoForm, repository_id: e.target.value })}>
            <option value="">— repository —</option>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input placeholder="ref/branch (main)" value={repoForm.ref} onChange={(e) => setRepoForm({ ...repoForm, ref: e.target.value })} />
          <input placeholder="version (1.7.0)" value={repoForm.repo_version} onChange={(e) => setRepoForm({ ...repoForm, repo_version: e.target.value })} />
          <button type="submit">Pin repo</button>
        </form>
      )}

      {/* Bundled items */}
      <h3 style={{ marginTop: 24 }}>📝 Bundled items</h3>
      <table className="grid">
        <thead><tr><th>Type</th><th>Key</th><th>Title</th><th>Author</th><th></th></tr></thead>
        <tbody>
          {rel.items.map((it) => (
            <tr key={it.id}>
              <td style={{ textTransform: 'capitalize' }}>{it.item_type}</td>
              <td><b>{it.item_key}</b></td>
              <td>{it.title}</td>
              <td>{it.author || '—'}</td>
              <td><button style={{ background: '#f87171' }} onClick={() => guard(() => api.removeReleaseItem(id, it.id))}>Remove</button></td>
            </tr>
          ))}
          {rel.items.length === 0 && <tr><td colSpan="5" className="empty">No items bundled.</td></tr>}
        </tbody>
      </table>
      <form className="inline-form" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); guard(async () => { await api.addReleaseItem(id, itemForm); setItemForm({ item_type: 'feature', item_key: '', title: '', author: '' }); }); }}>
        <select value={itemForm.item_type} onChange={(e) => setItemForm({ ...itemForm, item_type: e.target.value })}>
          <option value="feature">feature</option>
          <option value="bug">bug</option>
          <option value="hotfix">hotfix</option>
        </select>
        <input placeholder="key (FEAT-1042)" required value={itemForm.item_key} onChange={(e) => setItemForm({ ...itemForm, item_key: e.target.value })} />
        <input placeholder="title" required style={{ minWidth: 220 }} value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} />
        <input placeholder="author" value={itemForm.author} onChange={(e) => setItemForm({ ...itemForm, author: e.target.value })} />
        <button type="submit">Bundle item</button>
      </form>

      {/* Release notes */}
      <h3 style={{ marginTop: 24 }}>🧾 Release notes</h3>
      {rel.release_notes
        ? <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--panel,#0001)', padding: 16, borderRadius: 8 }}>{rel.release_notes}</pre>
        : <p className="empty">No notes generated yet — click “Generate release notes”.</p>}
    </div>
  );
}
