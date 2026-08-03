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
    channel: 'canary', server_ids: [], branch: '', custom_commands: '', scheduled_at: '',
    strategy: 'all_at_once', batch_size: 2, canary_count: 1,
  });

  const [me, setMe] = useState(null);
  const [approvals, setApprovals] = useState(null);
  const [approveForm, setApproveForm] = useState({ remark: '', file: null });
  const [showApprovalHistory, setShowApprovalHistory] = useState(false);
  const [approvalHistory, setApprovalHistory] = useState([]);
  const [delegateForm, setDelegateForm] = useState({ to_user: '', ends_at: '', reason: '' });
  const [users, setUsers] = useState([]);
  const [testStatus, setTestStatus] = useState(null);
  const [testStatusLoading, setTestStatusLoading] = useState(false);
  const [recurring, setRecurring] = useState([]);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurringForm, setRecurringForm] = useState({
    channel: 'canary', server_ids: [], interval_type: 'daily', day_of_week: 1, time_of_day: '02:00',
  });

  const [status, setStatus] = useState(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);

  const load = () => api.release(id).then(setRel).catch((e) => setErr(e.message));
  const loadApprovals = () => api.releaseApprovals(id).then(setApprovals).catch(() => {});
  const loadStatus = () => api.releaseStatus(id).then(setStatus).catch(() => {});
  const loadRecurring = () => api.recurringDeployments(id).then(setRecurring).catch(() => {});
  useEffect(() => {
    load();
    loadApprovals();
    loadStatus();
    loadRecurring();
    api.me().then(setMe).catch(() => {});
    api.repositories().then(setRepos).catch(() => {});
    api.channels().then(setChannels).catch(() => {});
    api.servers().then(setServers).catch(() => {});
  }, [id]);

  // Admin-only: the /users list (needed for the delegate-to picker) is admin-gated.
  useEffect(() => {
    if (me?.role === 'admin') api.users().then(setUsers).catch(() => {});
  }, [me]);

  const loadTestStatus = async () => {
    setTestStatusLoading(true); setErr('');
    try { setTestStatus(await api.releaseTestStatus(id)); } catch (e) { setErr(e.message); }
    setTestStatusLoading(false);
  };

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
    const scheduledAt = deployForm.scheduled_at ? new Date(deployForm.scheduled_at).toISOString() : undefined;
    const multiServer = deployForm.server_ids.length > 1;
    await api.deployRelease(id, {
      channel: deployForm.channel,
      server_ids: deployForm.server_ids,
      branch: deployForm.branch || undefined,
      custom_commands: deployForm.custom_commands
        ? deployForm.custom_commands.split('\n').map((s) => s.trim()).filter(Boolean)
        : undefined,
      scheduled_at: scheduledAt,
      strategy: multiServer ? deployForm.strategy : undefined,
      strategy_config: !multiServer ? undefined
        : deployForm.strategy === 'rolling' ? { batch_size: Number(deployForm.batch_size) || 1 }
        : deployForm.strategy === 'canary' ? { canary_count: Number(deployForm.canary_count) || 1 }
        : undefined,
    });
    setShowDeploy(false);
    setMsg(
      scheduledAt
        ? `Deployment to ${deployForm.channel} scheduled for ${new Date(scheduledAt).toLocaleString()}`
        : deployForm.server_ids.length
          ? `Deployment to ${deployForm.channel} created on ${deployForm.server_ids.length} server(s) — approve it on the Deployments board to start the agents`
          : `Deployment to ${deployForm.channel} created — approve it on the Deployments board`,
    );
    router.push('/deployments');
  });

  const guard = async (fn) => {
    setErr(''); setMsg('');
    try { await fn(); load(); } catch (e) { setErr(e.message); }
  };

  const createRecurring = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api.createRecurringDeployment({
        release_id: id,
        channel: recurringForm.channel,
        server_ids: recurringForm.server_ids,
        interval_type: recurringForm.interval_type,
        day_of_week: recurringForm.interval_type === 'weekly' ? Number(recurringForm.day_of_week) : undefined,
        time_of_day: recurringForm.time_of_day,
      });
      setShowRecurringForm(false);
      setMsg('Recurring deployment scheduled');
      loadRecurring();
    } catch (e2) { setErr(e2.message); }
  };

  const toggleRecurring = async (rule) => {
    setErr(''); setMsg('');
    try {
      await (rule.enabled ? api.disableRecurringDeployment(rule.id) : api.enableRecurringDeployment(rule.id));
      loadRecurring();
    } catch (e2) { setErr(e2.message); }
  };

  const deleteRecurring = async (rule) => {
    if (!confirm(`Delete this recurring deployment to ${rule.channel_name}?`)) return;
    setErr(''); setMsg('');
    try { await api.deleteRecurringDeployment(rule.id); loadRecurring(); } catch (e2) { setErr(e2.message); }
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: 'var(--muted)' }}>📅 Planned date:</span>
        <input type="date" value={rel.planned_date ? String(rel.planned_date).slice(0, 10) : ''}
          onChange={(e) => guard(() => api.updateRelease(id, { planned_date: e.target.value }))} />
      </div>

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
        <button style={{ marginLeft: 10, fontSize: 12 }} onClick={async () => {
          if (showApprovalHistory) { setShowApprovalHistory(false); return; }
          setShowApprovalHistory(true);
          try { setApprovalHistory(await api.releaseApprovalHistory(id)); } catch (e) { setErr(e.message); }
        }}>{showApprovalHistory ? 'Hide history' : 'View history'}</button>
      </h3>
      {approvals && approvals.required_count === 0 && (
        <p className="hint">No approvers configured for this release&apos;s product. Assign approval roles + products to users on the Users page.</p>
      )}
      {approvals && approvals.required_count > 0 && (
        <table className="grid">
          <thead><tr><th>Role</th><th>Approver</th><th>Decision</th><th>Remark</th><th>Attachments</th><th>When</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {approvals.approvers.map((a) => (
              <tr key={a.approver_id}>
                <td><b>{a.role_label}</b></td>
                <td>{a.email}</td>
                <td>
                  <span style={{ fontWeight: 700, color: a.decision === 'approved' ? '#22c55e' : a.decision === 'rejected' ? '#ef4444' : a.decision === 'expired' ? '#f97316' : 'var(--muted)' }}>
                    {a.decision}
                  </span>
                  {a.decided_by && <div style={{ fontSize: 11, color: 'var(--muted)' }}>by delegate {a.decided_by}</div>}
                  {a.expires_at && a.decision === 'approved' && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>expires {new Date(a.expires_at).toLocaleDateString()}</div>
                  )}
                </td>
                <td style={{ fontSize: 13 }}>{a.remark || '—'}</td>
                <td>
                  {(a.attachments || []).length === 0 ? '—' : a.attachments.map((att) => (
                    <button key={att.id} onClick={() => api.downloadApprovalAttachment(att.id, att.filename)}
                      style={{ fontSize: 11, marginRight: 4 }}>📎 {att.filename}</button>
                  ))}
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{a.decided_at ? new Date(a.decided_at).toLocaleString() : '—'}</td>
                {isAdmin && (
                  <td>
                    {a.decision !== 'pending' && (
                      <button style={{ fontSize: 11 }} onClick={() => guard(async () => {
                        await api.reRequestApproval(id, a.approver_id);
                        setMsg(`Re-requested ${a.role_label} sign-off`);
                        loadApprovals();
                      })}>Re-request</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showApprovalHistory && (
        approvalHistory.length === 0 ? <p className="empty" style={{ marginTop: 8 }}>No approval history yet.</p> : (
          <ul style={{ marginTop: 8 }}>
            {approvalHistory.map((h) => (
              <li key={h.id} style={{ fontSize: 13 }}>
                {new Date(h.occurred_at).toLocaleString()} — <b>{h.approval_role}</b>: {h.approver_email || '—'} → <b>{h.decision}</b>
                {h.note ? ` (${h.note})` : ''}{h.actor_email && h.actor_email !== h.approver_email ? ` · by ${h.actor_email}` : ''}
              </li>
            ))}
          </ul>
        )
      )}
      {isAdmin && approvals && approvals.required_count > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <h4 style={{ marginTop: 0 }}>Delegate an approver&apos;s sign-off</h4>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); guard(async () => {
            const fromUser = approvals.approvers.find((a) => a.email === delegateForm.from_email);
            if (!fromUser) return setErr('Pick a required approver to delegate from');
            await api.createApprovalDelegation({
              from_user: fromUser.approver_id, to_user: delegateForm.to_user,
              ends_at: new Date(delegateForm.ends_at).toISOString(), reason: delegateForm.reason || undefined,
            });
            setDelegateForm({ to_user: '', ends_at: '', reason: '' });
          }, 'Delegated'); }}>
            <select value={delegateForm.from_email || ''} onChange={(e) => setDelegateForm({ ...delegateForm, from_email: e.target.value })}>
              <option value="">— from approver —</option>
              {approvals.approvers.map((a) => <option key={a.approver_id} value={a.email}>{a.role_label} ({a.email})</option>)}
            </select>
            <select value={delegateForm.to_user} onChange={(e) => setDelegateForm({ ...delegateForm, to_user: e.target.value })}>
              <option value="">— to user —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            <input type="date" value={delegateForm.ends_at} onChange={(e) => setDelegateForm({ ...delegateForm, ends_at: e.target.value })} />
            <input placeholder="reason (optional)" value={delegateForm.reason} onChange={(e) => setDelegateForm({ ...delegateForm, reason: e.target.value })} />
            <button type="submit">Delegate</button>
          </form>
          <p className="hint" style={{ fontSize: 12, marginTop: 6 }}>
            While active, the delegate can submit a decision that counts as the original approver&apos;s sign-off.
          </p>
        </div>
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
              Branch (optional — overrides each repo&apos;s pinned branch)
              <input value={deployForm.branch} placeholder="leave empty = pinned/current branch"
                onChange={(e) => setDeployForm({ ...deployForm, branch: e.target.value })} />
            </label>

            {deployForm.server_ids.length > 1 && (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
                  Rollout strategy across the {deployForm.server_ids.length} selected servers
                  <select value={deployForm.strategy} onChange={(e) => setDeployForm({ ...deployForm, strategy: e.target.value })}>
                    <option value="all_at_once">All at once</option>
                    <option value="rolling">Rolling (batches, auto-advance)</option>
                    <option value="canary">Canary (staged, manual promote)</option>
                  </select>
                </label>
                {deployForm.strategy === 'rolling' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }}>
                    Batch size
                    <input type="number" min="1" max={deployForm.server_ids.length} value={deployForm.batch_size}
                      onChange={(e) => setDeployForm({ ...deployForm, batch_size: e.target.value })} style={{ width: 100 }} />
                  </label>
                )}
                {deployForm.strategy === 'canary' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }}>
                    Canary server count (first wave)
                    <input type="number" min="1" max={deployForm.server_ids.length - 1} value={deployForm.canary_count}
                      onChange={(e) => setDeployForm({ ...deployForm, canary_count: e.target.value })} style={{ width: 100 }} />
                  </label>
                )}
                {deployForm.strategy !== 'all_at_once' && (
                  <div className="hint" style={{ fontSize: 12, marginBottom: 12 }}>
                    {deployForm.strategy === 'rolling'
                      ? 'Each batch must fully succeed before the next starts; any batch failing stops the rollout and cancels the rest.'
                      : 'After the canary batch succeeds, the deployment pauses (awaiting_promotion) until you click Promote on the Deployments page; a failed canary stops the rollout.'}
                  </div>
                )}
              </>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }}>
              Schedule for later (optional — leave empty to deploy now)
              <input type="datetime-local" value={deployForm.scheduled_at}
                onChange={(e) => setDeployForm({ ...deployForm, scheduled_at: e.target.value })} />
            </label>
            {deployForm.scheduled_at && (
              <div className="hint" style={{ fontSize: 12, marginBottom: 12 }}>
                Scheduling skips the manual Approve step — it runs automatically at the
                scheduled time (deferred and re-checked every minute if an active freeze
                window covers it then).
              </div>
            )}

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

      {/* Test / CI status */}
      <h3 style={{ marginTop: 24 }}>🧪 Test Status
        <button style={{ marginLeft: 10, fontSize: 12 }} disabled={testStatusLoading} onClick={loadTestStatus}>
          {testStatusLoading ? 'Checking…' : testStatus ? 'Refresh' : 'Check GitHub status'}
        </button>
      </h3>
      {!testStatus ? (
        <p className="hint">
          Reads live GitHub Check Runs for each pinned repo&apos;s commit — whatever
          posts a check there (GitHub Actions, and any tool configured to report as a
          GitHub check, e.g. SonarQube Cloud, Codecov). Nothing runs on this platform.
        </p>
      ) : (
        <table className="grid">
          <thead><tr><th>Repository</th><th>Commit</th><th>Overall</th><th>Checks</th></tr></thead>
          <tbody>
            {testStatus.repositories.map((r) => (
              <tr key={r.repository_name}>
                <td><b>{r.repository_name}</b></td>
                <td><code>{String(r.commit_sha).slice(0, 10)}</code></td>
                <td>
                  <span style={{
                    fontWeight: 700,
                    color: r.overall === 'passed' ? '#22c55e' : r.overall === 'failed' ? '#ef4444'
                      : r.overall === 'pending' ? '#eab308' : 'var(--muted)',
                  }}>{r.overall.replace('_', ' ')}</span>
                  {r.reason && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.reason}</div>}
                </td>
                <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.checks.map((c) => (
                    <a key={c.name} href={c.url} target="_blank" rel="noreferrer" title={`${c.status}: ${c.conclusion || '—'}`} style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 6, textDecoration: 'none',
                      background: c.conclusion === 'success' ? '#16331f' : c.conclusion === 'failure' ? '#3a1620' : '#2a2f3a',
                      color: c.conclusion === 'success' ? '#22c55e' : c.conclusion === 'failure' ? '#ef4444' : '#94a3b8',
                    }}>{c.name}</a>
                  ))}
                  {r.checks.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Recurring deployments */}
      <h3 style={{ marginTop: 24 }}>🔁 Recurring Deployments
        <button style={{ marginLeft: 10, fontSize: 12 }} onClick={() => setShowRecurringForm((s) => !s)}>
          {showRecurringForm ? 'Cancel' : '+ New'}
        </button>
      </h3>
      <p className="hint">
        Redeploys this exact release to a channel on a schedule (e.g. a nightly
        environment refresh) — each firing goes through the same deploy checks as a
        manual deploy (approval gate, freeze windows, channel locking); a blocked
        firing is skipped, not forced.
      </p>
      {showRecurringForm && (
        <form className="inline-form" style={{ marginBottom: 8, flexWrap: 'wrap' }} onSubmit={createRecurring}>
          <select value={recurringForm.channel} onChange={(e) => setRecurringForm({ ...recurringForm, channel: e.target.value })}>
            {channels.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}
          </select>
          <select value={recurringForm.interval_type} onChange={(e) => setRecurringForm({ ...recurringForm, interval_type: e.target.value })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          {recurringForm.interval_type === 'weekly' && (
            <select value={recurringForm.day_of_week} onChange={(e) => setRecurringForm({ ...recurringForm, day_of_week: e.target.value })}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>time (UTC)
            <input type="time" value={recurringForm.time_of_day}
              onChange={(e) => setRecurringForm({ ...recurringForm, time_of_day: e.target.value })} style={{ display: 'block' }} />
          </label>
          <div style={{ minWidth: 220 }}>
            <ServerMultiSelect servers={servers} selected={recurringForm.server_ids}
              onChange={(ids) => setRecurringForm({ ...recurringForm, server_ids: ids })} />
          </div>
          <button type="submit">Schedule</button>
        </form>
      )}
      <table className="grid">
        <thead><tr><th>Channel</th><th>Recurrence</th><th>Servers</th><th>Status</th><th>Last run</th><th></th></tr></thead>
        <tbody>
          {recurring.map((r) => (
            <tr key={r.id}>
              <td>{r.channel_name}</td>
              <td>
                {r.interval_type === 'weekly'
                  ? `Weekly, ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.day_of_week]} ${r.time_of_day} UTC`
                  : `Daily ${r.time_of_day} UTC`}
              </td>
              <td>{(r.server_ids || []).length || 'tracking-only'}</td>
              <td>{r.enabled ? <span style={{ color: '#22c55e' }}>enabled</span> : <span style={{ color: 'var(--muted)' }}>disabled</span>}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : 'never'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => toggleRecurring(r)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                <button style={{ background: '#f87171' }} onClick={() => deleteRecurring(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {recurring.length === 0 && <tr><td colSpan="6" className="empty">No recurring deployments for this release.</td></tr>}
        </tbody>
      </table>

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
