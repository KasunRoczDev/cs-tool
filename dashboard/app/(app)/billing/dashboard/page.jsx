'use client';
import MetricCard from '@/components/ui/MetricCard';
import FilterBar from '@/components/ui/FilterBar';

import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const COLORS = ['#4f9dff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];


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
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [insightState, setInsightState] = useState('loading');
  const [insightError, setInsightError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [scope, setScope] = useState('month');
  const [month, setMonth] = useState(currentMonthStr());
  const [productId, setProductId] = useState('');

  useEffect(() => { api.products().then(setProducts).catch((e) => setLookupError(e.message)); }, [retry]);

  useEffect(() => {
    let active = true;
    setLoading(true); setErr('');
    api.billingDashboardSummary(6, scope, `${month}-01`, productId || undefined)
      .then((value) => { if (active) setSummary(value); }).catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, month, productId, retry]);
  useEffect(() => {
    let active = true;
    setInsightState('loading'); setInsightError('');
    api.billingInsights().then((value) => { if (active) { setInsights(value); setInsightState('content'); } })
      .catch((e) => { if (active) { setInsightError(e.message); setInsightState('error'); } });
    return () => { active = false; };
  }, [retry]);



  const fmt = (n) => summary && `${summary.currency} ${Number(n).toFixed(2)}`;
  const showMonthlyByProject = summary && summary.period !== 'month';
  const projectTrend = summary ? pivotProjectTrend(summary.project_trend) : { data: [], projects: [] };

  return (
    <div>
      <PageHeader {...getPageContext("/billing/dashboard")} />

      <FilterBar label="Billing period and project">
        <FormField label="Billing month"><input type="month" value={month} disabled={scope === 'all'}
          onChange={(e) => setMonth(e.target.value)} /></FormField>
        <FormField label="Period"><select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
        </select></FormField>
        <FormField label="Project"><select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField>
      </FilterBar>
      {lookupError && <FeedbackState kind="error" compact title="Projects unavailable" description={lookupError} action={<button onClick={() => { setLookupError(''); setRetry((n) => n + 1); }}>Retry</button>} />}
      {err && <FeedbackState kind="error" title="Billing summary unavailable" description={err} action={<button onClick={() => setRetry((n) => n + 1)}>Retry</button>} />}
      {loading && <FeedbackState kind="loading" compact title="Loading billing summary…" />}
      {!loading && !err && summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16, marginBottom: 20 }}>
            <MetricCard label={periodLabel(summary)} value={fmt(summary.period_total)} />
            {productId ? (
              <MetricCard label="Avg per month"
                value={summary.trend.length ? fmt(summary.trend.reduce((s, t) => s + t.total, 0) / summary.trend.length) : fmt(0)}
                detail={`Across ${summary.trend.length} billed month${summary.trend.length === 1 ? '' : 's'}`} />
            ) : (
              <>
                <MetricCard label="Projects with spend" value={summary.by_project.length} />
                <MetricCard label="Avg per project"
                  value={summary.by_project.length ? fmt(summary.period_total / summary.by_project.length) : fmt(0)} />
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18 }}>Spend trend</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={summary.trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(m) => m.slice(0, 7)} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} labelStyle={{ color: 'var(--text)' }} />
                <Line type="monotone" dataKey="total" stroke="#4f9dff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {summary.trend.length === 0 && <p className="empty">No billing records yet.</p>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16, marginBottom: 20 }}>
            <div className="card" style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>By Enterprise Project{showMonthlyByProject ? ' (monthly)' : ''}</h2>
              {showMonthlyByProject ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={projectTrend.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(m) => m.slice(0, 7)} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {projectTrend.projects.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="projects" fill={COLORS[i % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={summary.by_project} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="product_name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                    <Bar dataKey="total" fill="#4f9dff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {summary.by_project.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
            <div className="card" style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>By Service Type</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={summary.by_service_type} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="service_type" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                  <Bar dataKey="total" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {summary.by_service_type.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
            <div className="card" style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>By Provider</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={summary.by_provider} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="provider" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                  <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {summary.by_provider.length === 0 && <p className="empty">No billing records for this period.</p>}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18 }}>Top Services by Cost</h2>
            {summary.top_services.length === 0 ? (
              <p className="empty">No billing records for this period.</p>
            ) : (
              <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Dashboard table 1" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
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
</div>
            )}
          </div>
        </>
      )}

      <div className="card">
        <h2 style={{ fontSize: 18 }}>Cost Insights</h2>
        {insightState === 'loading' ? <FeedbackState kind="loading" compact title="Loading cost insights…" /> : insightState === 'error' ? <FeedbackState kind="error" compact description={insightError} action={<button onClick={() => setRetry((n) => n + 1)}>Retry</button>} /> : insights.length === 0 ? (
          <p className="empty">No cost flags — nothing looks obviously oversized or unused.</p>
        ) : (
          <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Dashboard table 2" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
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
</div>
        )}
      </div>
    </div>
  );
}
