'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { api } from '@/lib/api';

const COLORS = ['#4f9dff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];

function StatTile({ title, value, sub }) {
  return (
    <div className="card" style={{ flex: '1 1 220px' }}>
      <h4 style={{ margin: 0 }}>{title}</h4>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const FLAG_LABEL = {
  downsizing_candidate: 'Downsizing candidate',
  possibly_unused: 'Possibly unused',
};

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(summary) {
  if (summary.period === 'all') return 'All-time total';
  if (!summary.month) return 'Total';
  const [y, m] = summary.month.split('-');
  if (summary.period === 'year') return `${y} total`;
  const monthName = new Date(Date.UTC(Number(y), Number(m) - 1, 1))
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${monthName} ${y} total`;
}

// Pivots flat {month, product_id, product_name, total} rows into one row per
// month with a column per project, for a stacked bar chart.
function pivotProjectTrend(rows) {
  const byMonth = {};
  const projects = [];
  const seen = new Set();
  for (const r of rows) {
    if (!seen.has(r.product_name)) { seen.add(r.product_name); projects.push(r.product_name); }
    if (!byMonth[r.month]) byMonth[r.month] = { month: r.month };
    byMonth[r.month][r.product_name] = r.total;
  }
  const data = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  return { data, projects };
}

export default function BillingDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState('month');
  const [month, setMonth] = useState(currentMonthStr());
  const [productId, setProductId] = useState('');

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  useEffect(() => {
    api.billingDashboardSummary(6, scope, `${month}-01`, productId || undefined)
      .then(setSummary).catch((e) => setErr(e.message));
  }, [scope, month, productId]);
  useEffect(() => {
    api.billingInsights().then(setInsights).catch(() => {});
  }, []);

  if (err) return <div className="error">{err}</div>;

  const fmt = (n) => summary && `${summary.currency} ${Number(n).toFixed(2)}`;
  const showMonthlyByProject = summary && summary.period !== 'month';
  const projectTrend = summary ? pivotProjectTrend(summary.project_trend) : { data: [], projects: [] };

  return (
    <div>
      <div className="page-head"><h2>💰 Billing Dashboard</h2></div>

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <input type="month" value={month} disabled={scope === 'all'}
          onChange={(e) => setMonth(e.target.value)} />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
        </select>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!summary ? <p>Loading…</p> : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatTile title={periodLabel(summary)} value={fmt(summary.period_total)} />
            {productId ? (
              <StatTile title="Avg per month"
                value={summary.trend.length ? fmt(summary.trend.reduce((s, t) => s + t.total, 0) / summary.trend.length) : fmt(0)}
                sub={`Across ${summary.trend.length} billed month${summary.trend.length === 1 ? '' : 's'}`} />
            ) : (
              <>
                <StatTile title="Projects with spend" value={summary.by_project.length} />
                <StatTile title="Avg per project"
                  value={summary.by_project.length ? fmt(summary.period_total / summary.by_project.length) : fmt(0)} />
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h4>Spend trend</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={summary.trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9aa4b2' }} tickFormatter={(m) => m.slice(0, 7)} />
                <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} labelStyle={{ color: '#cbd5e1' }} />
                <Line type="monotone" dataKey="total" stroke="#4f9dff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {summary.trend.length === 0 && <p className="empty">No billing records yet.</p>}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <div className="card" style={{ flex: '1 1 320px' }}>
              <h4>By Enterprise Project{showMonthlyByProject ? ' (monthly)' : ''}</h4>
              {showMonthlyByProject ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={projectTrend.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9aa4b2' }} tickFormatter={(m) => m.slice(0, 7)} />
                    <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                    <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {projectTrend.projects.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="projects" fill={COLORS[i % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={summary.by_project} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                    <XAxis dataKey="product_name" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                    <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
                    <Bar dataKey="total" fill="#4f9dff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {summary.by_project.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
            <div className="card" style={{ flex: '1 1 320px' }}>
              <h4>By Service Type</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={summary.by_service_type} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                  <XAxis dataKey="service_type" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                  <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
                  <Bar dataKey="total" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {summary.by_service_type.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
            <div className="card" style={{ flex: '1 1 320px' }}>
              <h4>By Provider</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={summary.by_provider} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                  <XAxis dataKey="provider" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
                  <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
                  <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {summary.by_provider.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h4>Top Services by Cost</h4>
            {summary.top_services.length === 0 ? (
              <p className="empty">No billing records for this period.</p>
            ) : (
              <table className="grid">
                <thead><tr><th>Service</th><th>Project</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {summary.top_services.map((s) => (
                    <tr key={s.service_id}>
                      <td>{s.name}</td>
                      <td>{s.product_name}</td>
                      <td>{s.service_type}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <div className="card">
        <h4>Cost Insights</h4>
        {insights.length === 0 ? (
          <p className="empty">No cost flags — nothing looks obviously oversized or unused.</p>
        ) : (
          <table className="grid">
            <thead><tr><th>Service</th><th>Server</th><th>Flag</th><th>Avg CPU</th><th>Avg RAM</th><th>Amount</th><th>Reason</th></tr></thead>
            <tbody>
              {insights.map((f) => (
                <tr key={f.service_id}>
                  <td>{f.service_name}</td>
                  <td>{f.server_name}</td>
                  <td>{FLAG_LABEL[f.flag] || f.flag}</td>
                  <td>{f.avg_cpu != null ? `${f.avg_cpu.toFixed(1)}%` : '—'}</td>
                  <td>{f.avg_ram != null ? `${f.avg_ram.toFixed(1)}%` : '—'}</td>
                  <td>{summary ? fmt(f.amount) : f.amount}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
