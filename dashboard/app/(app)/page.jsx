'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import RegisterServer from '@/components/RegisterServer';

const ENV_OPTIONS = ['live', 'staging', 'dev', 'test'];
const UNASSIGNED = '— Unassigned —';

function EnvTag({ env }) {
  if (!env) return null;
  return (
    <span className={`overview-env-tag overview-env-${ENV_OPTIONS.includes(env) ? env : 'unknown'}`}>{env}</span>
  );
}

function EnvEditor({ serverId, currentEnv, onSaved }) {
  const [val, setVal] = useState(currentEnv || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateServer(serverId, { tags: { env: val } });
      onSaved(val);
    } catch {}
    setSaving(false);
  };

  return (
    <span className="overview-inline-editor">
      <select value={val} onChange={(e) => setVal(e.target.value)}
        className="overview-editor-select" aria-label="Server environment">
        <option value="">— none —</option>
        {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving} className="btn-primary overview-save-button">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </span>
  );
}

function ProductEditor({ serverId, currentProductId, products, onSaved }) {
  const [val, setVal] = useState(currentProductId || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateServer(serverId, { product_id: val });
      const name = products.find((p) => p.id === val)?.name || '';
      onSaved(val, name);
    } catch {}
    setSaving(false);
  };

  return (
    <span className="overview-inline-editor">
      <select value={val} onChange={(e) => setVal(e.target.value)}
        className="overview-editor-select" aria-label="Server product">
        <option value="">— unassigned —</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving} className="btn-primary overview-save-button">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </span>
  );
}

function bar(value) {
  const v = value ?? 0;
  const cls = v >= 90 ? 'crit' : v >= 75 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className="overview-meter-track">
        <div className={`meter-fill ${cls}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span>{value == null ? '—' : `${v.toFixed(0)}%`}</span>
    </div>
  );
}

export default function OverviewPage() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [showReg, setShowReg] = useState(false);
  const [editingEnv, setEditingEnv] = useState(null);     // server id
  const [editingProduct, setEditingProduct] = useState(null); // server id
  const [envFilter, setEnvFilter] = useState('');
  const [collapsed, setCollapsed] = useState({});         // { [productName]: bool }

  const load = () => {
    api.products().then(setProducts).catch(() => {});
    return api.servers().then((servers) => {
      api.overview().then((overview) => {
        const metricMap = Object.fromEntries(overview.map((o) => [o.id, o]));
        setRows(servers.map((s) => ({ ...s, ...metricMap[s.id] })));
      }).catch(() => setRows(servers));
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    const s = getSocket();
    if (!s) return;
    const onMetric = (m) =>
      setRows((rs) =>
        rs.map((r) =>
          r.id === m.server_id
            ? { ...r, cpu_usage: m.cpu_usage, memory_usage: m.memory_usage, disk_usage: m.disk_usage, status: 'online' }
            : r,
        ),
      );
    const onStatus = (p) =>
      setRows((rs) => rs.map((r) => (r.id === p.serverId ? { ...r, status: p.status } : r)));
    s.on('metric', onMetric);
    s.on('server_status', onStatus);
    const iv = setInterval(load, 30000);
    return () => {
      s.off('metric', onMetric);
      s.off('server_status', onStatus);
      clearInterval(iv);
    };
  }, []);

  const getEnv = (r) => r.tags?.env || '';

  const filtered = envFilter ? rows.filter((r) => getEnv(r) === envFilter) : rows;
  const onlineCount = rows.filter((r) => r.status === 'online').length;
  const offlineCount = rows.filter((r) => r.status === 'offline').length;
  const avgCpu = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.cpu_usage || 0), 0) / rows.length).toFixed(1) : 0;
  const avgMemory = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.memory_usage || 0), 0) / rows.length).toFixed(1) : 0;
  const liveCount = rows.filter((r) => getEnv(r) === 'live').length;
  const stagingCount = rows.filter((r) => getEnv(r) === 'staging').length;

  // Group filtered servers by product, ordered by the products list (then Unassigned last).
  const groups = (() => {
    const byName = {};
    for (const r of filtered) {
      const key = r.product_name || UNASSIGNED;
      (byName[key] ||= []).push(r);
    }
    const ordered = [];
    for (const p of products) {
      if (byName[p.name]) { ordered.push([p.name, byName[p.name]]); delete byName[p.name]; }
    }
    // Any product names present on servers but not in the products list, then Unassigned.
    for (const k of Object.keys(byName)) {
      if (k !== UNASSIGNED) ordered.push([k, byName[k]]);
    }
    if (byName[UNASSIGNED]) ordered.push([UNASSIGNED, byName[UNASSIGNED]]);
    return ordered;
  })();

  const updateRowEnv = (id, val) =>
    setRows((rs) => rs.map((s) => (s.id === id ? { ...s, tags: { ...s.tags, env: val } } : s)));
  const updateRowProduct = (id, productId, productName) =>
    setRows((rs) => rs.map((s) => (s.id === id ? { ...s, product_id: productId, product_name: productName } : s)));

  return (
    <div className="overview-page">
      <header className="page-head overview-header">
        <div>
          <h1>Server Overview</h1>
          <p>Server health and resource usage across products and environments.</p>
        </div>
        <div className="overview-actions">
          <button type="button" className="btn-primary" onClick={() => setShowReg(true)}>Add server</button>
        </div>
      </header>
      {showReg && <RegisterServer onClose={() => { setShowReg(false); load(); }} />}

      {/* Summary Cards */}
      <section className="overview-metrics" aria-label="Server summary">
        <div className="overview-metric">
          <h2 className="overview-metric-label">Total Servers</h2>
          <div className="overview-metric-value">{rows.length}</div>
          <div className="overview-metric-meta">Monitoring</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Products</h2>
          <div className="overview-metric-value">{products.length}</div>
          <div className="overview-metric-meta">Tracked products</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Online</h2>
          <div className="overview-metric-value is-online">{onlineCount}</div>
          <div className="overview-metric-meta">{rows.length > 0 ? ((onlineCount / rows.length) * 100).toFixed(0) : 0}% available</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Offline</h2>
          <div className="overview-metric-value is-offline">{offlineCount}</div>
          <div className="overview-metric-meta">Needs attention</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Live</h2>
          <div className="overview-metric-value is-live">{liveCount}</div>
          <div className="overview-metric-meta">Production servers</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Staging</h2>
          <div className="overview-metric-value is-staging">{stagingCount}</div>
          <div className="overview-metric-meta">Pre-prod servers</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Avg CPU</h2>
          <div className="overview-metric-value is-cpu">{avgCpu}%</div>
          <div className="overview-metric-meta">Average load</div>
        </div>
        <div className="overview-metric">
          <h2 className="overview-metric-label">Avg Memory</h2>
          <div className="overview-metric-value">{avgMemory}%</div>
          <div className="overview-metric-meta">Average usage</div>
        </div>
      </section>

      {/* Filter by env */}
      <div className="overview-filter overview-section" role="group" aria-labelledby="overview-environment-label">
        <span id="overview-environment-label" className="overview-filter-label">Environment</span>
        <div className="overview-filter-options">
        {['', ...ENV_OPTIONS].map((e) => (
          <button key={e} type="button" onClick={() => setEnvFilter(e)}
            className={`overview-filter-button focus-ring${envFilter === e ? ' is-selected' : ''}`}
            aria-pressed={envFilter === e}>
            {e || 'All'}
          </button>
        ))}
        </div>
      </div>

      {/* One section per product */}
      {groups.map(([productName, servers]) => {
        const isCollapsed = collapsed[productName];
        const online = servers.filter((r) => r.status === 'online').length;
        const panelId = `overview-servers-${encodeURIComponent(productName)}`;
        const groupLabel = productName === UNASSIGNED ? 'Unassigned' : productName;
        return (
          <section key={productName} className="overview-product-group" aria-label={groupLabel}>
            <h2 className="overview-group-heading">
              <button type="button" className="overview-product-group-head overview-group-toggle"
                aria-expanded={!isCollapsed} aria-controls={panelId}
                onClick={() => setCollapsed((c) => ({ ...c, [productName]: !c[productName] }))}>
                <span className="overview-group-title">
                  <svg className="overview-group-chevron" width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d={isCollapsed ? 'm9 6 6 6-6 6' : 'm6 9 6 6 6-6'} />
                  </svg>
                  <span>{groupLabel}</span>
                </span>
                <span className="overview-group-count">
                  {servers.length} server{servers.length !== 1 ? 's' : ''} · {online} online
                </span>
              </button>
            </h2>
            <div id={panelId} className="overview-table-wrap focus-ring" hidden={isCollapsed}
              role="region" aria-label={`${groupLabel} servers`} tabIndex={0}>
              {!isCollapsed && (
                <table className="grid overview-server-table" aria-label={`${groupLabel} servers`}>
                  <thead>
                    <tr><th scope="col">Status</th><th scope="col">Name</th><th scope="col">Environment</th><th scope="col">Product</th><th scope="col">CPU</th><th scope="col">Memory</th><th scope="col">Disk</th><th scope="col">Last seen</th></tr>
                  </thead>
                  <tbody>
                    {servers.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="overview-server-status">
                            <span className={`dot ${r.status}`} aria-hidden="true" />
                            <span>{r.status || 'unknown'}</span>
                          </span>
                        </td>
                        <td><Link href={`/servers/${r.id}`} className="overview-server-link focus-ring" title={r.name}>{r.name}</Link></td>
                        <td>
                          {editingEnv === r.id ? (
                            <EnvEditor serverId={r.id} currentEnv={getEnv(r)} onSaved={(val) => { updateRowEnv(r.id, val); setEditingEnv(null); }} />
                          ) : (
                            <span className="overview-editable-cell">
                              <EnvTag env={getEnv(r)} />
                              <button type="button" onClick={() => setEditingEnv(r.id)}
                                className="btn-secondary overview-edit-button" aria-label={`Edit environment for ${r.name}`}>Edit</button>
                            </span>
                          )}
                        </td>
                        <td>
                          {editingProduct === r.id ? (
                            <ProductEditor serverId={r.id} currentProductId={r.product_id} products={products}
                              onSaved={(pid, pname) => { updateRowProduct(r.id, pid, pname); setEditingProduct(null); }} />
                          ) : (
                            <span className="overview-editable-cell">
                              <span className={`overview-product-name${r.product_name ? '' : ' muted'}`} title={r.product_name || 'Unassigned'}>
                                {r.product_name || '—'}
                              </span>
                              <button type="button" onClick={() => setEditingProduct(r.id)}
                                className="btn-secondary overview-edit-button" aria-label={`Edit product for ${r.name}`}>Edit</button>
                            </span>
                          )}
                        </td>
                        <td>{bar(r.cpu_usage)}</td>
                        <td>{bar(r.memory_usage)}</td>
                        <td>{bar(r.disk_usage)}</td>
                        <td className="overview-last-seen">{r.last_seen ? new Date(r.last_seen).toLocaleTimeString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        );
      })}

      {groups.length === 0 && (
        <div className="overview-card overview-empty" role="status">
          <strong>{rows.length === 0 ? 'No servers configured' : 'No servers match the filter'}</strong>
          <p>{rows.length === 0
            ? 'Add a server to start monitoring it here.'
            : `No servers are tagged with the ${envFilter} environment. Select All to see every server.`}</p>
          {rows.length === 0 ? (
            <button type="button" className="btn-primary" onClick={() => setShowReg(true)}>Add server</button>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setEnvFilter('')}>Show all servers</button>
          )}
        </div>
      )}
      <style jsx global>{`
        .overview-page .overview-metrics { align-items: start; }
        .overview-page .overview-metric { border-color: transparent; }
        .overview-page .overview-metric-label { margin: 0; line-height: 1.4; }
        .overview-page .overview-metric-value { color: var(--accent); }
        .overview-page .overview-metric-value.is-online { color: var(--ok); }
        .overview-page .overview-metric-value.is-offline { color: var(--crit); }
        .overview-page .overview-metric-value.is-live { color: var(--env-live); }
        .overview-page .overview-metric-value.is-staging { color: var(--env-staging); }
        .overview-page .overview-metric-value.is-cpu { color: var(--warn); }
        .overview-page .overview-filter { align-items: center; }
        .overview-page .overview-filter-label { color: var(--muted); font-size: 13px; font-weight: 600; }
        .overview-page .overview-filter-options { display: flex; flex-wrap: wrap; gap: 6px; }
        .overview-page .overview-filter-button {
          padding: 6px 12px; background: transparent; color: var(--text);
          border: 1px solid var(--border); font-size: 12px;
        }
        .overview-page .modal-backdrop { z-index: 50; }
        .overview-page .modal { max-width: calc(100vw - 32px); }
        .overview-page .overview-filter-button:hover { background: var(--panel-2); filter: none; }
        .overview-page .overview-filter-button.is-selected {
          background: var(--accent); color: var(--accent-foreground); border-color: var(--accent);
        }
        .overview-page .overview-group-heading { margin: 0; font-size: 14px; }
        .overview-page .overview-group-toggle {
          width: 100%; border-radius: 0; background: var(--panel-2); color: var(--text); text-align: left;
        }
        .overview-page .overview-group-toggle[aria-expanded="false"] { border-bottom-color: transparent; }
        .overview-page .overview-group-toggle:hover { background: var(--surface-raised); filter: none; }
        .overview-page .overview-group-toggle:focus-visible,
        .overview-page .overview-table-wrap:focus-visible { outline-offset: -3px; }
        .overview-page .overview-group-title { display: flex; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
        .overview-page .overview-group-chevron { flex: 0 0 16px; color: var(--muted); }
        .overview-page .overview-group-count { flex-shrink: 0; color: var(--muted); font-size: 12px; font-weight: 400; }
        .overview-page .overview-server-table { margin: 0; border-radius: 0; }
        .overview-page .overview-server-table thead { background: var(--panel-2); }
        .overview-page .overview-server-table td { vertical-align: middle; font-variant-numeric: tabular-nums; }
        .overview-page .overview-server-table tbody tr:last-child td { border-bottom: 0; }
        .overview-page .overview-server-table tbody tr:hover { background: var(--surface-raised); }
        .overview-page .overview-server-status { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; text-transform: capitalize; white-space: nowrap; }
        .overview-page .overview-server-status .dot { flex: 0 0 8px; width: 8px; height: 8px; box-shadow: none; }
        .overview-page .overview-server-link { display: block; width: max-content; max-width: 240px; overflow-wrap: anywhere; font-weight: 600; }
        .overview-page .overview-server-link:hover { text-decoration: underline; text-underline-offset: 3px; }
        .overview-page .overview-editable-cell,
        .overview-page .overview-inline-editor { display: inline-flex; align-items: center; gap: 8px; }
        .overview-page .overview-edit-button,
        .overview-page .overview-save-button { flex-shrink: 0; padding: 5px 8px; font-size: 12px; }
        .overview-page .overview-editor-select { width: 150px; font-size: 12px; }
        .overview-page .overview-product-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .overview-page .overview-env-tag {
          display: inline-block; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;
          color: var(--env-color); background: var(--env-background); border: 1px solid var(--env-border);
        }
        .overview-page .overview-env-live { --env-color: var(--env-live); --env-background: color-mix(in srgb, var(--env-live) 12%, transparent); --env-border: color-mix(in srgb, var(--env-live) 45%, transparent); }
        .overview-page .overview-env-staging { --env-color: var(--env-staging); --env-background: color-mix(in srgb, var(--env-staging) 12%, transparent); --env-border: color-mix(in srgb, var(--env-staging) 45%, transparent); }
        .overview-page .overview-env-dev { --env-color: var(--env-dev); --env-background: color-mix(in srgb, var(--env-dev) 12%, transparent); --env-border: color-mix(in srgb, var(--env-dev) 45%, transparent); }
        .overview-page .overview-env-test { --env-color: var(--env-test); --env-background: color-mix(in srgb, var(--env-test) 12%, transparent); --env-border: color-mix(in srgb, var(--env-test) 45%, transparent); }
        .overview-page .overview-env-unknown { --env-color: var(--muted); --env-background: color-mix(in srgb, var(--muted) 12%, transparent); --env-border: color-mix(in srgb, var(--muted) 45%, transparent); }
        .overview-page .overview-server-table .overview-last-seen { font-size: 12px; color: var(--muted); white-space: nowrap; }
        .overview-page .meter { display: flex; align-items: center; gap: 8px; width: 100px; background: transparent; overflow: visible; }
        .overview-page .overview-meter-track { width: 55px; height: 5px; flex-shrink: 0; border-radius: 5px; background: var(--panel-2); overflow: hidden; }
        .overview-page .meter-fill { border-radius: inherit; }
        .overview-page .meter span { position: static; margin-left: auto; color: var(--text); font-variant-numeric: tabular-nums; }
        @media (max-width: 760px) {
          .overview-page .overview-group-toggle { align-items: flex-start; flex-direction: column; gap: 6px; }
          .overview-page .overview-group-count { padding-left: 24px; }
        }
      `}</style>
    </div>
  );
}
