'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import GitGraph from '@/components/GitGraph';
import BranchManager from '@/components/BranchManager';

export default function RepositoriesPage() {
  const [repos, setRepos] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    name: '', slug: '', remote_url: '', provider: 'github',
    default_branch: 'main', tech_stack: '', docker_image_name: '', github_token: '', product_id: '',
  });
  const [versionsFor, setVersionsFor] = useState(null); // repo id
  const [versions, setVersions] = useState([]);
  const [vForm, setVForm] = useState({ version: '', commit_sha: '' });
  const [graphRepo, setGraphRepo] = useState(null); // repo for the visualizer
  const [branchRepo, setBranchRepo] = useState(null); // repo for branch manager

  const load = () => api.repositories().then(setRepos).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.products().then(setProducts).catch(() => {});
  }, []);

  const create = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.createRepository({
        ...form,
        product_id: form.product_id || undefined,
        github_token: form.github_token || undefined,
        tech_stack: form.tech_stack ? form.tech_stack.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      setForm({ name: '', slug: '', remote_url: '', provider: 'github', default_branch: 'main', tech_stack: '', docker_image_name: '', github_token: '', product_id: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  // Assign / change a repository's product.
  const changeProduct = async (r, productId) => {
    setErr(''); setMsg('');
    try {
      await api.updateRepository(r.id, { product_id: productId });
      setMsg(`${r.name} assigned to ${products.find((p) => p.id === productId)?.name || 'Unassigned'}.`);
      load();
    } catch (e) { setErr(e.message); }
  };

  const sync = async (r) => {
    setErr(''); setMsg('');
    try { const res = await api.syncRepository(r.id); setMsg(`Synced ${r.name} — tip ${String(res.metadata?.head_sha || '').slice(0, 8)}`); load(); }
    catch (e) { setErr(e.message); }
  };

  const remove = async (r) => {
    if (!confirm(`Delete repository "${r.name}"?`)) return;
    setErr('');
    try { await api.deleteRepository(r.id); load(); } catch (e) { setErr(e.message); }
  };

  // Set / rotate / clear the per-repo GitHub token. Empty input clears it.
  const setTokenFor = async (r) => {
    const t = prompt(
      `GitHub token for "${r.name}"\n(leave blank and OK to clear the stored token):`,
      '',
    );
    if (t === null) return; // cancelled
    setErr(''); setMsg('');
    try {
      await api.updateRepository(r.id, { github_token: t });
      setMsg(t ? `Token saved for ${r.name}.` : `Token cleared for ${r.name}.`);
      load();
    } catch (e) { setErr(e.message); }
  };

  const openVersions = async (r) => {
    if (versionsFor === r.id) { setVersionsFor(null); return; }
    setVersionsFor(r.id);
    try { setVersions(await api.repoVersions(r.id)); } catch (e) { setErr(e.message); }
  };

  const addVersion = async (r) => {
    setErr('');
    try {
      await api.createRepoVersion(r.id, vForm);
      setVForm({ version: '', commit_sha: '' });
      setVersions(await api.repoVersions(r.id));
      load();
    } catch (e) { setErr(e.message); }
  };

  // Group repositories by product so the table reads product → its repos.
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of repos) {
      const key = r.product_name || '— Unassigned —';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    }
    return Array.from(m.entries()).sort((a, b) => {
      if (a[0].startsWith('—')) return 1;
      if (b[0].startsWith('—')) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [repos]);

  const renderRepoRows = (list) => list.map((r) => (
    <>
      <tr key={r.id}>
        <td style={{ paddingLeft: 24 }}>
          <b>{r.name}</b><br />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{r.slug}</span>
        </td>
        <td>
          <select value={r.product_id || ''} onChange={(e) => changeProduct(r, e.target.value)}
            title="Assign product" style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5,
              background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--fg)', minWidth: 120 }}>
            <option value="">— Unassigned —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </td>
        <td>{r.provider}</td>
        <td>{r.default_branch}</td>
        <td>
          {r.has_token
            ? <span style={{ color: '#22c55e' }}>● token set</span>
            : <span style={{ color: 'var(--muted)' }}>no token</span>}
        </td>
        <td><button onClick={() => openVersions(r)}>{r.version_count} ▾</button></td>
        <td>{r.last_synced_at ? new Date(r.last_synced_at).toLocaleString() : <span style={{ color: 'var(--muted)' }}>never</span>}</td>
        <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setBranchRepo(r)} disabled={r.provider !== 'github'}
            title={r.provider === 'github' ? 'Manage branches' : 'GitHub only'}>Branches</button>
          <button onClick={() => setGraphRepo(r)} disabled={r.provider !== 'github'}
            title={r.provider === 'github' ? 'Open git graph' : 'GitHub only'}>Graph</button>
          <button onClick={() => setTokenFor(r)}>{r.has_token ? 'Token' : 'Set token'}</button>
          <button onClick={() => sync(r)}>Sync</button>
          <button onClick={() => remove(r)} style={{ background: '#f87171' }}>Delete</button>
        </td>
      </tr>
      {versionsFor === r.id && (
        <tr key={r.id + '-v'}>
          <td colSpan="8" style={{ background: 'var(--panel,#0001)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input placeholder="version (1.7.0)" value={vForm.version}
                onChange={(e) => setVForm({ ...vForm, version: e.target.value })} />
              <input placeholder="commit sha (optional)" value={vForm.commit_sha}
                onChange={(e) => setVForm({ ...vForm, commit_sha: e.target.value })} />
              <button onClick={() => addVersion(r)}>Tag version</button>
            </div>
            {versions.length === 0 ? <span className="empty">No versions tagged.</span> : (
              <ul style={{ margin: 0 }}>
                {versions.map((v) => (
                  <li key={v.id}><b>{v.version}</b> {v.commit_sha && <code>{String(v.commit_sha).slice(0, 8)}</code>} <span style={{ color: 'var(--muted)' }}>· {new Date(v.created_at).toLocaleDateString()}</span></li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  ));

  return (
    <div>
      <div className="page-head"><h2>📚 Repositories</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="name (e.g. Master-BE)" required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="slug (master-be)" required value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <input placeholder="remote url" required style={{ minWidth: 220 }} value={form.remote_url}
          onChange={(e) => setForm({ ...form, remote_url: e.target.value })} />
        <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
          <option value="github">github</option>
          <option value="gitlab">gitlab</option>
          <option value="bitbucket">bitbucket</option>
        </select>
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} title="Product">
          <option value="">— product (optional) —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input placeholder="default branch" style={{ width: 110 }} value={form.default_branch}
          onChange={(e) => setForm({ ...form, default_branch: e.target.value })} />
        <input placeholder="tech stack (comma sep)" value={form.tech_stack}
          onChange={(e) => setForm({ ...form, tech_stack: e.target.value })} />
        <input type="password" placeholder="github token (optional)" value={form.github_token}
          onChange={(e) => setForm({ ...form, github_token: e.target.value })} />
        <button type="submit">Add repository</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Name</th><th>Product</th><th>Provider</th><th>Default branch</th><th>Token</th><th>Versions</th><th>Last sync</th><th></th></tr>
        </thead>
        <tbody>
          {groups.map(([product, list]) => (
            <>
              <tr key={`grp-${product}`}>
                <td colSpan="8" style={{ background: 'var(--panel,#11151c)', fontWeight: 600 }}>
                  📦 {product} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>· {list.length} repo{list.length === 1 ? '' : 's'}</span>
                </td>
              </tr>
              {renderRepoRows(list)}
            </>
          ))}
          {repos.length === 0 && <tr><td colSpan="8" className="empty">No repositories yet.</td></tr>}
        </tbody>
      </table>

      <p className="hint" style={{ marginTop: 16 }}>
        Repositories are grouped by product. Add a GitHub token per repo to enable
        live branch listing and the commit graph (open it with <b>Graph</b>). Tokens
        are encrypted at rest and never returned to the browser. Sync uses the token
        to fetch the real tip SHA of the default branch.
      </p>

      {graphRepo && <GitGraph repo={graphRepo} onClose={() => setGraphRepo(null)} />}
      {branchRepo && <BranchManager repo={branchRepo} onClose={() => setBranchRepo(null)} />}
    </div>
  );
}
