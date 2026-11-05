'use client';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import FeedbackState from '@/components/ui/FeedbackState';
import StatusBadge from '@/components/ui/StatusBadge';
import FormField from '@/components/ui/FormField';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPageContext } from '@/lib/navigation';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import MetricChart from '@/components/MetricChart';
import PaginatedEventList from '@/components/PaginatedEventList';
import RegenerateKey from '@/components/RegenerateKey';
import ServerAppConfigCard from '@/components/ServerAppConfigCard';

const MAX_POINTS = 120;
const fmt = (iso) => new Date(iso).toLocaleTimeString();

export default function ServerDetailPage() {
  const { id } = useParams();
  const [server, setServer] = useState(null);
  const [series, setSeries] = useState([]);
  const [events, setEvents] = useState([]);
  const [hostedApps, setHostedApps] = useState([]);
  const [allApps, setAllApps] = useState([]);
  const [linkAppId, setLinkAppId] = useState('');
  const [appsErr, setAppsErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState('');
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsLoadError, setAppsLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadServer = useCallback(() => {
    setLoading(true); setError('');
    return api.server(id).then(setServer).catch((e) => setError(e.message || 'Unable to load server')).finally(() => setLoading(false));
  }, [id]);
  const loadMetrics = useCallback(() => {
    setMetricsLoading(true); setMetricsError('');
    return api.metrics(id).then((rows) => setSeries(rows.map((r) => ({
      t: fmt(r.time), cpu: r.cpu_usage, mem: r.memory_usage, disk: r.disk_usage, net_in: r.net_in, net_out: r.net_out,
    })))).catch((e) => setMetricsError(e.message || 'Unable to load metrics')).finally(() => setMetricsLoading(false));
  }, [id]);
  const loadEvents = useCallback(() => {
    setEventsLoading(true); setEventsError('');
    return api.securityEvents(id).then(setEvents).catch((e) => setEventsError(e.message || 'Unable to load events')).finally(() => setEventsLoading(false));
  }, [id]);
  const loadHostedApps = useCallback(() => {
    setAppsLoading(true); setAppsLoadError('');
    return api.serverApps(id).then(setHostedApps).catch((e) => setAppsLoadError(e.message || 'Unable to load hosted apps')).finally(() => setAppsLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    loadServer();
    loadMetrics();
    loadEvents();
    loadHostedApps();
    api.apps().then(setAllApps).catch((e) => setAppsErr(e.message || 'Unable to load available apps'));

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
  }, [id, loadEvents, loadHostedApps, loadMetrics, loadServer]);


  const linkApp = async () => {
    if (!linkAppId) { setAppsErr('Pick an app first'); return; }
    setAppsErr(''); setSaving(true); setMessage('');
    try {
      await api.linkServerApp(id, { app_id: linkAppId });
      setLinkAppId('');
      await loadHostedApps(); setMessage('App links updated');
    } catch (e) { setAppsErr(e.message); } finally { setSaving(false); }
  };

  const unlinkApp = async (a) => {
    if (!confirm(`Unlink "${a.app_name}"?`)) return;
    setAppsErr(''); setSaving(true); setMessage('');
    try {
      await api.unlinkServerApp(id, a.app_id);
      await loadHostedApps(); setMessage('App links updated');
    } catch (e) { setAppsErr(e.message); } finally { setSaving(false); }
  };

  if (!server) return <div style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <PageHeader {...getPageContext('/servers/[id]')} title={'Server details'} breadcrumbs={[{ label: 'Overview', href: '/' }, { label: 'Server details' }]} wide />
    {loading && <FeedbackState kind="loading" title="Loading server…" />}
    {error && <FeedbackState kind="error" description={error} action={<button onClick={loadServer}>Retry</button>} />}
    <div aria-busy={loading} />
  </div>;

  return (
    <div>
      <PageHeader {...getPageContext('/servers/[id]')} title={server.name} description={server.hostname || server.ip_address || ''} breadcrumbs={[{ label: 'Overview', href: '/' }, { label: server.name }]} actions={<><StatusBadge status={server.status} /><RegenerateKey serverId={id} /></>} wide />
      <SectionHeader title="Resource metrics" />
      {metricsLoading && <FeedbackState kind="loading" title="Loading metrics…" />}
      {metricsError && <FeedbackState kind="error" description={metricsError} action={<button onClick={loadMetrics}>Retry</button>} />}
      {!metricsLoading && !metricsError && series.length === 0 && <FeedbackState title="No metrics yet" />}
      <div aria-busy={metricsLoading}>
      <div className="chart-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
        <MetricChart title="CPU %" data={series} dataKey="cpu" color="#4f9dff" />
        <MetricChart title="Memory %" data={series} dataKey="mem" color="#34d399" />
        <MetricChart title="Disk %" data={series} dataKey="disk" color="#fbbf24" />
        <MetricChart title="Network In (B/s)" data={series} dataKey="net_in" unit="" color="#a78bfa" domain={['auto', 'auto']} />
      </div>

      </div>
      <SectionHeader title="Security events" actions={<>
        <Link href={`/security?serverId=${id}`} style={{ fontSize: '13px', color: 'var(--accent)', textDecoration: 'none' }}>
          View all in Security →
        </Link>
      </>} />
      {eventsLoading && <FeedbackState kind="loading" title="Loading security events…" />}
      {eventsError && <FeedbackState kind="error" description={eventsError} action={<button onClick={loadEvents}>Retry</button>} />}
      <div aria-busy={eventsLoading}>
      {!eventsLoading && !eventsError && <PaginatedEventList
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
      />}
      </div>

      <SectionHeader title="Hosted apps" />
      {appsLoading && <FeedbackState kind="loading" title="Loading hosted apps…" />}
      {appsLoadError && <FeedbackState kind="error" description={appsLoadError} action={<button onClick={loadHostedApps}>Retry</button>} />}
      {appsErr && <FeedbackState kind="error" title="Unable to update app links" description={appsErr} />}
      {message && <p role="status">{message}</p>}
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select aria-label="App to link" value={linkAppId} onChange={(e) => setLinkAppId(e.target.value)}>
          <option value="">— select app —</option>
          {allApps
            .filter((a) => !hostedApps.some((h) => h.app_id === a.id))
            .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button disabled={saving || appsLoading || !linkAppId} onClick={linkApp}>{saving ? 'Saving…' : 'Link app'}</button>
      </div>
      <div aria-busy={appsLoading}>
      {(hostedApps.length > 0 || (!appsLoading && !appsLoadError)) && (hostedApps.length === 0 ? (
        <FeedbackState title="No apps linked to this server yet" />
      ) : (
        hostedApps.map((a) => (
          <ServerAppConfigCard
            key={a.id}
            title={a.app_name}
            config={a}
            onSave={(edits) => api.updateServerApp(id, a.app_id, edits).then(loadHostedApps)}
            onUnlink={() => unlinkApp(a)}
          />
        ))
      ))}
      </div>
    </div>
  );
}
