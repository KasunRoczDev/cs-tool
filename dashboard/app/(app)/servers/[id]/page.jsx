'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import MetricChart from '@/components/MetricChart';
import PaginatedEventList from '@/components/PaginatedEventList';

const MAX_POINTS = 120;
const fmt = (iso) => new Date(iso).toLocaleTimeString();

export default function ServerDetailPage() {
  const { id } = useParams();
  const [server, setServer] = useState(null);
  const [series, setSeries] = useState([]);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!id) return;
    api.server(id).then(setServer).catch(() => {});
    api.metrics(id).then((rows) =>
      setSeries(rows.map((r) => ({
        t: fmt(r.time),
        cpu: r.cpu_usage, mem: r.memory_usage, disk: r.disk_usage,
        net_in: r.net_in, net_out: r.net_out,
      }))),
    ).catch(() => {});
    api.securityEvents(id).then(setEvents).catch(() => {});

    const s = getSocket();
    if (!s) return;
    s.emit('subscribe', id);
    const onMetric = (m) => {
      if (m.server_id !== id) return;
      setSeries((prev) => [
        ...prev.slice(-(MAX_POINTS - 1)),
        { t: fmt(m.time), cpu: m.cpu_usage, mem: m.memory_usage, disk: m.disk_usage, net_in: m.net_in, net_out: m.net_out },
      ]);
    };
    const onEvent = (e) => {
      if (e.server_id !== id) return;
      setEvents((prev) => [e, ...prev].slice(0, 200));
    };
    s.on('metric', onMetric);
    s.on('security_event', onEvent);
    return () => {
      s.off('metric', onMetric);
      s.off('security_event', onEvent);
    };
  }, [id]);

  if (!server) return <div>Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <h2>{server.name} <span className={`dot ${server.status}`} /></h2>
        <span className="muted">{server.hostname || server.ip_address || ''}</span>
      </div>

      <div className="chart-grid">
        <MetricChart title="CPU %" data={series} dataKey="cpu" color="#4f9dff" />
        <MetricChart title="Memory %" data={series} dataKey="mem" color="#34d399" />
        <MetricChart title="Disk %" data={series} dataKey="disk" color="#fbbf24" />
        <MetricChart title="Network In (B/s)" data={series} dataKey="net_in" unit="" color="#a78bfa" domain={['auto', 'auto']} />
      </div>

      <div className="page-head" style={{ marginTop: '24px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Security events</h3>
        <Link href={`/security?serverId=${id}`} style={{ fontSize: '13px', color: 'var(--accent)', textDecoration: 'none' }}>
          View all in Security →
        </Link>
      </div>
      <PaginatedEventList
        events={events.map((e, i) => ({
          id: e.id || i,
          timestamp: e.time || e.timestamp,
          type: e.event_type,
          severity: e.severity,
          message: e.message,
          source_ip: e.source_ip,
          username: e.username,
        }))}
        title="Recent security events"
        itemsPerPage={15}
      />
    </div>
  );
}
