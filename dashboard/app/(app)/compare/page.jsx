'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import FilterBar from '@/components/ui/FilterBar';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';

const COLORS = ['#4f9dff', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee'];

export default function ComparePage() {
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [data, setData] = useState([]);

  const [serversLoading, setServersLoading] = useState(true);
  const [serversError, setServersError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const loadServers = () => {
    setServersLoading(true); setServersError('');
    api.servers().then(setServers).catch((e) => setServersError(e.message || 'Unable to load servers')).finally(() => setServersLoading(false));
  };
  useEffect(() => { loadServers(); }, []);

  useEffect(() => {
    let active = true;
    setError('');
    if (selected.length === 0) { setData([]); setLoading(false); return; }
    setLoading(true);
    Promise.all(selected.map((id) => api.metrics(id))).then((all) => {
      const map = {};
      all.forEach((rows, i) => {
        const id = selected[i];
        rows.forEach((r) => {
          const t = new Date(r.time).toLocaleTimeString();
          map[t] = map[t] || { t };
          map[t][id] = r.cpu_usage;
        });
      });
      if (active) setData(Object.values(map));
    }).catch((e) => { if (active) setError(e.message || 'Unable to load comparison'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected, retry]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <PageHeader {...getPageContext('/compare')} wide />
      <SectionHeader title="Compare CPU usage" />
      {serversLoading && <FeedbackState kind="loading" title="Loading servers…" />}
      {serversError && <FeedbackState kind="error" description={serversError} action={<button onClick={loadServers}>Retry</button>} />}
      {!serversLoading && !serversError && servers.length === 0 && <FeedbackState title="No servers available" description="Add a server from Overview to compare metrics." />}
      {loading && <FeedbackState kind="loading" title="Loading comparison…" />}
      {error && <FeedbackState kind="error" description={error} action={<button onClick={() => setRetry((r) => r + 1)}>Retry</button>} />}
      <FilterBar label="Servers to compare">
        {servers.map((s) => (
          <button
            key={s.id}
            aria-pressed={selected.includes(s.id)}
            className={`chip ${selected.includes(s.id) ? 'on' : ''}`}
            onClick={() => toggle(s.id)}
          >{s.name}</button>
        ))}
      </FilterBar>
      <div className="card" aria-busy={loading}>
        {!loading && !error && data.length > 0 && <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={40} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
            <Legend />
            {selected.map((id, i) => {
              const name = servers.find((s) => s.id === id)?.name || id;
              return <Line key={id} type="monotone" dataKey={id} name={name} stroke={COLORS[i % COLORS.length]} dot={false} isAnimationActive={false} />;
            })}
          </LineChart>
        </ResponsiveContainer>}
        {!serversLoading && !serversError && selected.length === 0 && <FeedbackState title="Select servers to compare" />}
        {!loading && !error && selected.length > 0 && data.length === 0 && <FeedbackState title="No metrics in this range" />}
      </div>
    </div>
  );
}
