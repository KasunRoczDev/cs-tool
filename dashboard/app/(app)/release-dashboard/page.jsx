'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

function Card({ title, children, empty }) {
  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      {empty ? <p className="empty">{empty}</p> : children}
    </div>
  );
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

const CALENDAR_ICON = { release: '🚀', deployment: '🛳️', freeze: '🧊' };

export default function ReleaseDashboardPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  const load = () => api.releaseDashboard(productId || undefined).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-head">
        <h2>🏠 Release Dashboard</h2>
        <button onClick={load}>↻ Refresh</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— all products —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!data ? (
        <p className="empty">Loading…</p>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Card title="Active Releases" empty={data.active_releases.length === 0 ? 'No active releases.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.active_releases.map((r) => (
                <li key={r.id}>
                  <Link href={`/releases/${r.id}`}>{r.version}</Link>
                  {' — '}{r.status_name}{r.product_name ? ` (${r.product_name})` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Pending Approvals" empty={data.pending_approvals.length === 0 ? 'No pending approvals.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.pending_approvals.map((a, i) => (
                <li key={`${a.release_id}-${a.role}-${i}`}>
                  <Link href={`/releases/${a.release_id}`}>{a.version}</Link>
                  {' — '}{a.role} ({a.awaiting_email}){a.product_name ? ` · ${a.product_name}` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Upcoming Releases (14d)" empty={data.upcoming_releases.length === 0 ? 'Nothing planned in the next 14 days.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.upcoming_releases.map((r) => (
                <li key={r.id}>
                  <Link href={`/releases/${r.id}`}>{r.version}</Link>
                  {' — '}{fmtDate(r.planned_date)}{r.product_name ? ` (${r.product_name})` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Current Production Version" empty={data.production_versions.length === 0 ? 'No production deployments yet.' : null}>
            <table className="grid">
              <thead><tr><th>Product</th><th>Version</th><th>Deployed</th></tr></thead>
              <tbody>
                {data.production_versions.map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.product_name || '—'}</td>
                    <td>{p.version || '—'}</td>
                    <td>{fmtDate(p.deployed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Pipeline Health (7d)">
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {data.pipeline_health.rate != null ? `${Math.round(data.pipeline_health.rate * 100)}%` : '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {data.pipeline_health.succeeded} succeeded / {data.pipeline_health.failed} failed
            </div>
          </Card>

          <Card title="Next 14 Days" empty={data.mini_calendar.length === 0 ? 'Nothing scheduled.' : null}>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {data.mini_calendar.map((i, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  {CALENDAR_ICON[i.type] || '•'} {fmtDate(i.date)} — {i.label}
                </li>
              ))}
            </ul>
            <Link href="/release-calendar" style={{ fontSize: 12 }}>View full calendar →</Link>
          </Card>
        </div>
      )}
    </div>
  );
}
