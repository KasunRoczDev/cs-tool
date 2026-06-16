'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { api } from '@/lib/api';

const COLORS = ['#4f9dff', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee'];

export default function ComparePage() {
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [data, setData] = useState([]);

  useEffect(() => { api.servers().then(setServers).catch(() => {}); }, []);

  useEffect(() => {
    if (selected.length === 0) { setData([]); return; }
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
      setData(Object.values(map));
    });
  }, [selected]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      <h2>Multi-server comparison (CPU %)</h2>
      <div className="chip-row">
        {servers.map((s) => (
          <button
            key={s.id}
            className={`chip ${selected.includes(s.id) ? 'on' : ''}`}
            onClick={() => toggle(s.id)}
          >{s.name}</button>
        ))}
      </div>
      <div className="card">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#9aa4b2' }} minTickGap={40} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9aa4b2' }} unit="%" />
            <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
            <Legend />
            {selected.map((id, i) => {
              const name = servers.find((s) => s.id === id)?.name || id;
              return <Line key={id} type="monotone" dataKey={id} name={name} stroke={COLORS[i % COLORS.length]} dot={false} isAnimationActive={false} />;
            })}
          </LineChart>
        </ResponsiveContainer>
        {selected.length === 0 && <div className="empty">Select servers to compare.</div>}
      </div>
    </div>
  );
}
