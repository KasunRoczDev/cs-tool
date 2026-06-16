'use client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

export default function MetricChart({ title, data, dataKey, unit = '%', color = '#4f9dff', domain }) {
  return (
    <div className="card">
      <h4>{title}</h4>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
          <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#9aa4b2' }} minTickGap={40} />
          <YAxis domain={domain || [0, 100]} tick={{ fontSize: 11, fill: '#9aa4b2' }} unit={unit} />
          <Tooltip
            contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
