'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

// ── Node palette ────────────────────────────────────────────────────────────
const NODE_TYPES = {
  client:       { label: 'Client',        icon: '👤', color: '#8b9bb4' },
  firewall:     { label: 'Firewall',      icon: '🧱', color: '#f87171' },
  loadbalancer: { label: 'Load Balancer', icon: '⚖️', color: '#fbbf24' },
  ip:           { label: 'IP',            icon: '🌐', color: '#4f9dff' },
  server:       { label: 'Server',        icon: '🖥️', color: '#34d399' },
  db:           { label: 'Database',      icon: '🗄️', color: '#a78bfa' },
};
const TYPE_ORDER = ['client', 'firewall', 'loadbalancer', 'ip', 'server', 'db'];
const ENVIRONMENTS = ['dev', 'qa', 'staging', 'production'];

const NW = 152;  // node width
const NH = 58;   // node height
const CANVAS_W = 2600;
const CANVAS_H = 1600;

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function TopologyPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [env, setEnv] = useState('production');
  const [envCounts, setEnvCounts] = useState({}); // { env: nodeCount }

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null); // { kind:'node'|'edge', id }
  const [linkPos, setLinkPos] = useState(null);    // temp line endpoint while drawing
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState(null); // { updated_at, updated_by }

  const svgRef = useRef(null);
  const interact = useRef(null); // { mode:'node'|'link', id, ox, oy }

  // ── Load products ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.products()
      .then((p) => {
        setProducts(p);
        if (p.length && !productId) setProductId(p[0].id);
      })
      .catch((e) => setErr(e.message));
  }, []); // eslint-disable-line

  // ── Load graph whenever product or env changes ──────────────────────────────
  const loadGraph = useCallback(() => {
    if (!productId) return;
    setErr(''); setStatus('');
    api.topology(productId, env)
      .then((g) => {
        setNodes(Array.isArray(g.nodes) ? g.nodes : []);
        setEdges(Array.isArray(g.edges) ? g.edges : []);
        setSelected(null);
        setDirty(false);
      })
      .catch((e) => setErr(e.message));
    api.topologyEnvs(productId)
      .then((rows) => {
        const c = {};
        for (const r of rows) c[r.environment] = r.node_count;
        setEnvCounts(c);
        const row = rows.find((r) => r.environment === env);
        setMeta(row ? { updated_at: row.updated_at } : null);
      })
      .catch(() => {});
  }, [productId, env]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // ── Geometry helpers ────────────────────────────────────────────────────────
  const svgPoint = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    return {
      x: clamp(clientX - r.left, 0, CANVAS_W),
      y: clamp(clientY - r.top, 0, CANVAS_H),
    };
  };
  const nodeById = useMemo(() => {
    const m = {}; for (const n of nodes) m[n.id] = n; return m;
  }, [nodes]);
  const center = (n) => ({ x: n.x + NW / 2, y: n.y + NH / 2 });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const addNode = (type, x, y) => {
    const n = {
      id: uid(),
      type,
      label: NODE_TYPES[type].label,
      ip: '',
      x: clamp(x - NW / 2, 8, CANVAS_W - NW - 8),
      y: clamp(y - NH / 2, 8, CANVAS_H - NH - 8),
    };
    setNodes((ns) => [...ns, n]);
    setSelected({ kind: 'node', id: n.id });
    setDirty(true);
  };

  // Uses a functional updater so it stays correct even when invoked from the
  // window pointerup handler (which captures an early render's closure).
  const addEdge = (from, to) => {
    if (from === to) return;
    setEdges((es) =>
      es.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))
        ? es
        : [...es, { id: uid(), from, to, label: '' }]);
    setDirty(true);
  };

  const patchNode = (id, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setDirty(true);
  };
  const patchEdge = (id, patch) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  };
  const deleteSelected = useCallback(() => {
    if (!selected) return;
    if (selected.kind === 'node') {
      setNodes((ns) => ns.filter((n) => n.id !== selected.id));
      setEdges((es) => es.filter((e) => e.from !== selected.id && e.to !== selected.id));
    } else {
      setEdges((es) => es.filter((e) => e.id !== selected.id));
    }
    setSelected(null);
    setDirty(true);
  }, [selected]);

  // ── Pointer interactions (drag node / draw link) ────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      const st = interact.current;
      if (!st) return;
      const p = svgPoint(e.clientX, e.clientY);
      if (st.mode === 'node') {
        setNodes((ns) => ns.map((n) =>
          n.id === st.id
            ? { ...n, x: clamp(p.x - st.ox, 8, CANVAS_W - NW - 8), y: clamp(p.y - st.oy, 8, CANVAS_H - NH - 8) }
            : n));
      } else if (st.mode === 'link') {
        setLinkPos(p);
      }
    };
    const onUp = (e) => {
      const st = interact.current;
      if (!st) return;
      if (st.mode === 'node' && st.moved) setDirty(true);
      if (st.mode === 'link') {
        const target = nodeIdFromPoint(e.clientX, e.clientY);
        if (target && target !== st.id) addEdge(st.id, target);
        setLinkPos(null);
      }
      interact.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []); // eslint-disable-line

  const nodeIdFromPoint = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el) {
      if (el.dataset && el.dataset.nodeId) return el.dataset.nodeId;
      el = el.parentElement;
    }
    return null;
  };

  const startNodeDrag = (e, n) => {
    e.stopPropagation();
    setSelected({ kind: 'node', id: n.id });
    const p = svgPoint(e.clientX, e.clientY);
    interact.current = { mode: 'node', id: n.id, ox: p.x - n.x, oy: p.y - n.y, moved: false };
  };
  // mark moved so a plain click doesn't flag dirty
  useEffect(() => {
    const mark = () => { if (interact.current?.mode === 'node') interact.current.moved = true; };
    window.addEventListener('pointermove', mark);
    return () => window.removeEventListener('pointermove', mark);
  }, []);

  const startLink = (e, n) => {
    e.stopPropagation();
    interact.current = { mode: 'link', id: n.id };
    setLinkPos(svgPoint(e.clientX, e.clientY));
  };

  // keyboard delete
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'Escape') { setSelected(null); setLinkPos(null); interact.current = null; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, deleteSelected]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!productId) return;
    setErr(''); setStatus('Saving…');
    try {
      await api.saveTopology(productId, env, { nodes, edges });
      setDirty(false);
      setStatus('Saved ✓');
      setEnvCounts((c) => ({ ...c, [env]: nodes.length }));
      setTimeout(() => setStatus(''), 2000);
    } catch (e) { setErr(e.message); setStatus(''); }
  };

  // ── DnD from palette ────────────────────────────────────────────────────────
  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type');
    if (!type || !NODE_TYPES[type]) return;
    const p = svgPoint(e.clientX, e.clientY);
    addNode(type, p.x, p.y);
  };

  const linkSource = interact.current?.mode === 'link' ? nodeById[interact.current.id] : null;
  const selNode = selected?.kind === 'node' ? nodeById[selected.id] : null;
  const selEdge = selected?.kind === 'edge' ? edges.find((e) => e.id === selected.id) : null;

  return (
    <div>
      <div className="page-head">
        <h2>🕸️ Topology</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dirty && <span className="muted" style={{ fontSize: 13 }}>● unsaved changes</span>}
          {status && <span style={{ fontSize: 13, color: 'var(--ok)' }}>{status}</span>}
          <button onClick={save} disabled={!productId || !dirty}>💾 Save</button>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {products.length === 0 ? (
        <p className="hint">Create a product first on the <b>Products</b> page — topology graphs are kept per product, per environment.</p>
      ) : (
        <>
          {/* product + environment selectors */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ margin: 0 }}>
              <span style={{ marginRight: 8 }}>Product</span>
              <select style={{ width: 220, display: 'inline-block' }} value={productId}
                onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div className="env-tabs">
              {ENVIRONMENTS.map((ev) => (
                <button key={ev} className={'env-tab' + (ev === env ? ' active' : '')}
                  onClick={() => setEnv(ev)}>
                  {ev}{envCounts[ev] ? <span className="env-count">{envCounts[ev]}</span> : null}
                </button>
              ))}
            </div>
            {meta?.updated_at && (
              <span className="muted" style={{ fontSize: 12 }}>
                updated {new Date(meta.updated_at).toLocaleString()}
              </span>
            )}
          </div>

          <div className="topo-wrap">
            {/* palette */}
            <div className="topo-palette">
              <div className="palette-title">Drag onto canvas</div>
              {TYPE_ORDER.map((t) => (
                <div key={t} className="palette-item" draggable
                  onDragStart={(e) => e.dataTransfer.setData('node-type', t)}
                  onClick={() => addNode(t, CANVAS_W / 2 - 200 + Math.random() * 400, 120 + Math.random() * 200)}
                  style={{ borderLeft: `4px solid ${NODE_TYPES[t].color}` }}
                  title="Drag to canvas, or click to add">
                  <span className="palette-icon">{NODE_TYPES[t].icon}</span> {NODE_TYPES[t].label}
                </div>
              ))}
              <p className="palette-hint">
                Drag the small dot on a node&apos;s right edge to another node to draw a relation.
                Click a node or line to edit it. Press <kbd>Del</kbd> to remove.
              </p>
            </div>

            {/* canvas */}
            <div className="topo-canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              <svg ref={svgRef} width={CANVAS_W} height={CANVAS_H}
                onPointerDown={() => setSelected(null)}>
                <defs>
                  <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3"
                    orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0,0 L9,3 L0,6 Z" fill="var(--muted)" />
                  </marker>
                  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                    <path d="M32 0H0V32" fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.4" />
                  </pattern>
                </defs>
                <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

                {/* edges */}
                {edges.map((e) => {
                  const a = nodeById[e.from], b = nodeById[e.to];
                  if (!a || !b) return null;
                  const c1 = center(a), c2 = center(b);
                  const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;
                  const isSel = selected?.kind === 'edge' && selected.id === e.id;
                  return (
                    <g key={e.id} style={{ cursor: 'pointer' }}
                      onPointerDown={(ev) => { ev.stopPropagation(); setSelected({ kind: 'edge', id: e.id }); }}>
                      <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                        stroke="transparent" strokeWidth="14" />
                      <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                        stroke={isSel ? 'var(--accent)' : 'var(--muted)'}
                        strokeWidth={isSel ? 3 : 2} markerEnd="url(#arrow)" />
                      {e.label && (
                        <g>
                          <rect x={mx - e.label.length * 3.6 - 6} y={my - 11}
                            width={e.label.length * 7.2 + 12} height={20} rx={5}
                            fill="var(--panel-2)" stroke="var(--border)" />
                          <text x={mx} y={my + 4} textAnchor="middle"
                            fontSize="12" fill="var(--text)">{e.label}</text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* temp link line */}
                {linkPos && linkSource && (
                  <line x1={center(linkSource).x} y1={center(linkSource).y}
                    x2={linkPos.x} y2={linkPos.y}
                    stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4"
                    style={{ pointerEvents: 'none' }} />
                )}

                {/* nodes */}
                {nodes.map((n) => {
                  const meta = NODE_TYPES[n.type] || NODE_TYPES.server;
                  const isSel = selected?.kind === 'node' && selected.id === n.id;
                  return (
                    <g key={n.id} data-node-id={n.id} transform={`translate(${n.x},${n.y})`}
                      style={{ cursor: 'grab' }} onPointerDown={(e) => startNodeDrag(e, n)}>
                      <rect width={NW} height={NH} rx={9}
                        fill="var(--panel)" stroke={isSel ? 'var(--accent)' : meta.color}
                        strokeWidth={isSel ? 2.5 : 1.5} />
                      <rect width={6} height={NH} rx={3} fill={meta.color} />
                      <text x={16} y={24} fontSize="18">{meta.icon}</text>
                      <text x={40} y={23} fontSize="13" fontWeight="600" fill="var(--text)">
                        {(n.label || meta.label).slice(0, 16)}
                      </text>
                      <text x={40} y={42} fontSize="11" fill="var(--muted)">
                        {n.ip ? n.ip.slice(0, 18) : meta.label}
                      </text>
                      {/* connector handle */}
                      <circle cx={NW} cy={NH / 2} r={7}
                        fill="var(--accent)" stroke="var(--bg)" strokeWidth="2"
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => startLink(e, n)}>
                        <title>Drag to another node to create a relation</title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* inspector */}
            <div className="topo-inspector">
              {!selected && (
                <p className="muted" style={{ fontSize: 13 }}>
                  Select a node or relation to edit it. Nothing selected.
                </p>
              )}
              {selNode && (
                <>
                  <div className="insp-title">{NODE_TYPES[selNode.type]?.icon} Node</div>
                  <label>Type
                    <select value={selNode.type} onChange={(e) => patchNode(selNode.id, { type: e.target.value })}>
                      {TYPE_ORDER.map((t) => <option key={t} value={t}>{NODE_TYPES[t].label}</option>)}
                    </select>
                  </label>
                  <label>Label
                    <input value={selNode.label || ''} placeholder={NODE_TYPES[selNode.type]?.label}
                      onChange={(e) => patchNode(selNode.id, { label: e.target.value })} />
                  </label>
                  <label>IP / address
                    <input value={selNode.ip || ''} placeholder="e.g. 10.0.1.5"
                      onChange={(e) => patchNode(selNode.id, { ip: e.target.value })} />
                  </label>
                  <button onClick={deleteSelected} style={{ background: 'var(--crit)', marginTop: 10 }}>
                    Delete node
                  </button>
                </>
              )}
              {selEdge && (
                <>
                  <div className="insp-title">🔗 Relation</div>
                  <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                    {nodeById[selEdge.from]?.label || '?'} → {nodeById[selEdge.to]?.label || '?'}
                  </p>
                  <label>Label
                    <input value={selEdge.label || ''} placeholder="e.g. HTTPS, TCP 5432"
                      onChange={(e) => patchEdge(selEdge.id, { label: e.target.value })} />
                  </label>
                  <button onClick={deleteSelected} style={{ background: 'var(--crit)', marginTop: 10 }}>
                    Delete relation
                  </button>
                </>
              )}
              <div className="insp-stats">
                {nodes.length} node{nodes.length !== 1 ? 's' : ''} · {edges.length} relation{edges.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
