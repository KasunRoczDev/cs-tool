'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';

function StatTile({ title, value }) {
  return (
    <div className="card" style={{ flex: '1 1 220px' }}>
      <h4 style={{ margin: 0 }}>{title}</h4>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{value}</div>
    </div>
  );
}

const FLAG_LABEL = {
  downsizing_candidate: 'Downsizing candidate',
  possibly_unused: 'Possibly unused',
};

export default function BillingDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.billingDashboardSummary(6).then(setSummary).catch((e) => setErr(e.message));
    api.billingInsights().then(setInsights).catch(() => {});
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!summary) return <p>Loading…</p>;

  const fmt = (n) => `${summary.currency} ${Number(n).toFixed(2)}`;

  return (
    <div>
      <div className="page-head"><h2>💰 Billing Dashboard</h2></div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile title="Current month total" value={fmt(summary.current_month_total)} />
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
          <h4>By Enterprise Project</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.by_project} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
              <XAxis dataKey="product_name" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
              <Bar dataKey="total" fill="#4f9dff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {summary.by_project.length === 0 && <p className="empty">No billing records this month.</p>}
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
          {summary.by_service_type.length === 0 && <p className="empty">No billing records this month.</p>}
        </div>
      </div>

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
                  <td>{fmt(f.amount)}</td>
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
