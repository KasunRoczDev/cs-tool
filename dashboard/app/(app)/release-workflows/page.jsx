'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const CATEGORIES = ['draft', 'stage', 'terminal'];
const KINDS = ['forward', 'rollback', 'archive'];

export default function ReleaseWorkflowsPage() {
  const [workflows, setWorkflows] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [newWorkflow, setNewWorkflow] = useState({ name: '', product_id: '' });
  const [newStatus, setNewStatus] = useState({ key: '', name: '', rank: 0, category: 'stage', channel_key: '', color: '#3b82f6' });
  const [newTransition, setNewTransition] = useState({ from_status_key: '', to_status_key: '', kind: 'forward', require_approval: true, auto_deploy: false });

  const loadWorkflows = () => api.workflows().then(setWorkflows).catch((e) => setErr(e.message));
  useEffect(() => {
    loadWorkflows();
    api.products().then(setProducts).catch(() => {});
  }, []);

  const loadDetail = (id) => api.workflowDetail(id).then(setDetail).catch((e) => setErr(e.message));
  const select = (id) => { setSelectedId(id); setErr(''); loadDetail(id); };

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const createWorkflow = () => guard(async () => {
    if (!newWorkflow.name || !newWorkflow.product_id) return setErr('Name and product are required');
    const wf = await api.createWorkflow(newWorkflow);
    setNewWorkflow({ name: '', product_id: '' });
    await loadWorkflows();
    select(wf.id);
  }, 'Workflow created');

  const deleteWorkflow = (id) => guard(async () => {
    if (!confirm('Delete this workflow? This cannot be undone.')) return;
    await api.deleteWorkflow(id);
    if (selectedId === id) { setSelectedId(null); setDetail(null); }
    await loadWorkflows();
  }, 'Workflow deleted');

  const createStatus = () => guard(async () => {
    if (!newStatus.key || !newStatus.name) return setErr('Key and name are required');
    await api.createWorkflowStatus(selectedId, { ...newStatus, rank: Number(newStatus.rank) || 0 });
    setNewStatus({ key: '', name: '', rank: 0, category: 'stage', channel_key: '', color: '#3b82f6' });
    await loadDetail(selectedId);
  }, 'Status added');

  const deleteStatus = (statusId) => guard(async () => {
    if (!confirm('Delete this status? Transitions that reference it are removed too.')) return;
    await api.deleteWorkflowStatus(selectedId, statusId);
    await loadDetail(selectedId);
  }, 'Status deleted');

  const createTransition = () => guard(async () => {
    if (!newTransition.to_status_key) return setErr('Target status is required');
    await api.createWorkflowTransition(selectedId, {
      ...newTransition,
      from_status_key: newTransition.from_status_key || undefined,
    });
    setNewTransition({ from_status_key: '', to_status_key: '', kind: 'forward', require_approval: true, auto_deploy: false });
    await loadDetail(selectedId);
  }, 'Transition added');

  const deleteTransition = (transitionId) => guard(async () => {
    await api.deleteWorkflowTransition(selectedId, transitionId);
    await loadDetail(selectedId);
  }, 'Transition deleted');

  return (
    <div>
      <div className="page-head"><h2>🧭 Release Workflow Configuration</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      <p className="hint" style={{ marginBottom: 16 }}>
        Each product can have its own release status workflow instead of the seeded default
        (draft → canary → beta → production → enterprise → archived). Adding a status
        automatically provisions its <code>status.transition.&lt;key&gt;</code> permission so
        roles can be granted access to use it on the Access Control page.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Workflow list */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Workflows</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {workflows.map((w) => (
              <button key={w.id} onClick={() => select(w.id)}
                style={{
                  textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                  background: selectedId === w.id ? 'var(--panel-2)' : 'transparent',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}>
                <b>{w.name}</b>{w.is_default && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>(default)</span>}
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{w.product_name || 'global'} · {w.statuses.length} statuses</div>
              </button>
            ))}
            {workflows.length === 0 && <p className="empty">No workflows yet.</p>}
          </div>
          <h5 style={{ marginBottom: 6 }}>New workflow</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input placeholder="Name" value={newWorkflow.name} onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })} />
            <select value={newWorkflow.product_id} onChange={(e) => setNewWorkflow({ ...newWorkflow, product_id: e.target.value })}>
              <option value="">— product —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={createWorkflow}>Create</button>
          </div>
        </div>

        {/* Workflow builder */}
        {!detail ? (
          <p className="empty">Select a workflow to edit its statuses and transitions.</p>
        ) : (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{detail.name} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>— {detail.product_name || 'global'}</span></h3>
                {!detail.is_default && (
                  <button style={{ background: '#f87171' }} onClick={() => deleteWorkflow(detail.id)}>Delete workflow</button>
                )}
              </div>
            </div>

            <h4>Statuses</h4>
            <table className="grid">
              <thead><tr><th>Rank</th><th>Key</th><th>Name</th><th>Category</th><th>Channel</th><th>Color</th><th></th></tr></thead>
              <tbody>
                {detail.statuses.map((s) => (
                  <tr key={s.id}>
                    <td>{s.rank}</td>
                    <td><code>{s.key}</code></td>
                    <td>{s.name}</td>
                    <td>{s.category}</td>
                    <td>{s.channel_key || '—'}</td>
                    <td><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: s.color || 'var(--border)' }} /></td>
                    <td><button style={{ background: '#f87171' }} onClick={() => deleteStatus(s.id)}>Remove</button></td>
                  </tr>
                ))}
                {detail.statuses.length === 0 && <tr><td colSpan="7" className="empty">No statuses yet.</td></tr>}
              </tbody>
            </table>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); createStatus(); }}>
              <input placeholder="key (qa_review)" value={newStatus.key} onChange={(e) => setNewStatus({ ...newStatus, key: e.target.value })} style={{ width: 120 }} />
              <input placeholder="name (QA Review)" value={newStatus.name} onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })} style={{ width: 140 }} />
              <input type="number" placeholder="rank" value={newStatus.rank} onChange={(e) => setNewStatus({ ...newStatus, rank: e.target.value })} style={{ width: 70 }} />
              <select value={newStatus.category} onChange={(e) => setNewStatus({ ...newStatus, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="channel_key (optional)" value={newStatus.channel_key} onChange={(e) => setNewStatus({ ...newStatus, channel_key: e.target.value })} style={{ width: 130 }} />
              <input type="color" value={newStatus.color} onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })} style={{ width: 40, padding: 2 }} />
              <button type="submit">Add status</button>
            </form>

            <h4 style={{ marginTop: 24 }}>Transitions</h4>
            <table className="grid">
              <thead><tr><th>From</th><th>To</th><th>Kind</th><th>Approval?</th><th>Auto-deploy?</th><th>Permission</th><th></th></tr></thead>
              <tbody>
                {detail.transitions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.from_name || <span style={{ color: 'var(--muted)' }}>any</span>}</td>
                    <td><b>{t.to_name}</b></td>
                    <td>{t.kind}</td>
                    <td>{t.require_approval ? 'Yes' : 'No'}</td>
                    <td>{t.auto_deploy ? 'Yes' : 'No'}</td>
                    <td style={{ fontSize: 12 }}><code>{t.required_permission}</code></td>
                    <td><button style={{ background: '#f87171' }} onClick={() => deleteTransition(t.id)}>Remove</button></td>
                  </tr>
                ))}
                {detail.transitions.length === 0 && <tr><td colSpan="7" className="empty">No transitions yet.</td></tr>}
              </tbody>
            </table>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); createTransition(); }}>
              <select value={newTransition.from_status_key} onChange={(e) => setNewTransition({ ...newTransition, from_status_key: e.target.value })}>
                <option value="">from: any</option>
                {detail.statuses.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
              <select required value={newTransition.to_status_key} onChange={(e) => setNewTransition({ ...newTransition, to_status_key: e.target.value })}>
                <option value="">— to status —</option>
                {detail.statuses.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
              <select value={newTransition.kind} onChange={(e) => setNewTransition({ ...newTransition, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={newTransition.require_approval} onChange={(e) => setNewTransition({ ...newTransition, require_approval: e.target.checked })} />
                requires approval
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={newTransition.auto_deploy} onChange={(e) => setNewTransition({ ...newTransition, auto_deploy: e.target.checked })} />
                auto-deploy
              </label>
              <button type="submit">Add transition</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
