'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

// ── Constants ──────────────────────────────────────────────────────────────
const ALERT_TYPES = [
  '', // = All types
  'cpu_high', 'mem_high', 'disk_full', 'offline', 'ssh_bruteforce',
  'brute_force', 'ssh_failed_login', 'firewall_block', 'port_scan',
  'privilege_escalation', 'sudo', 'malware', 'data_exfiltration',
  // PHP-FPM alerts
  'fpm_max_children_reached', 'fpm_pool_saturated', 'fpm_listen_queue_backlog',
  'fpm_slow_requests', 'fpm_hot_worker', 'fpm_unreachable',
];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const SEV_COLORS = { low: '#34d399', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };

const STATUS_COLORS = { sent: '#34d399', failed: '#f87171', suppressed: '#94a3b8' };

function SevPill({ s }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700,
      background: (SEV_COLORS[s] || '#888') + '22', color: SEV_COLORS[s] || '#888',
      border: `1px solid ${(SEV_COLORS[s] || '#888')}55`,
    }}>{s}</span>
  );
}

function StatusDot({ s }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: STATUS_COLORS[s] || '#888', marginRight: 5,
    }} />
  );
}

// ── Channel Form ───────────────────────────────────────────────────────────
function ChannelForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? {
    name: '', type: 'email', to: '', cc: '', subject_prefix: '[Monitor Alert]',
    webhook_url: '', username: 'Server Monitor', enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isDiscord = form.type === 'discord';

  const save = async () => {
    if (!form.name.trim()) return setErr('Name is required');
    if (isDiscord) {
      if (!form.webhook_url.trim()) return setErr('Discord webhook URL is required');
    } else if (!form.to.trim()) {
      return setErr('Recipient email is required');
    }
    setSaving(true); setErr('');
    try {
      const body = isDiscord
        ? {
            name: form.name,
            type: 'discord',
            config: { webhook_url: form.webhook_url.trim(), username: form.username || undefined },
            enabled: form.enabled,
          }
        : {
            name: form.name,
            type: 'email',
            config: { to: form.to, cc: form.cc || undefined, subject_prefix: form.subject_prefix || '[Monitor Alert]' },
            enabled: form.enabled,
          };
      await onSave(body);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h4 style={{ marginBottom: 16 }}>{initial ? 'Edit Channel' : 'New Channel'}</h4>
      {err && <div style={{ color: 'var(--crit)', marginBottom: 10, fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Channel name
          <input value={form.name} onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Ops team alerts" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Channel type
          <select value={form.type} onChange={(e) => set('type', e.target.value)} disabled={!!initial}>
            <option value="email">Email</option>
            <option value="discord">Discord</option>
          </select>
        </label>

        {isDiscord ? (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Discord webhook URL
              <input value={form.webhook_url} onChange={(e) => set('webhook_url', e.target.value)}
                placeholder="https://discord.com/api/webhooks/…" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Bot display name (optional)
              <input value={form.username} onChange={(e) => set('username', e.target.value)}
                placeholder="Server Monitor" />
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              In Discord: Channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.
            </div>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Recipients (comma-separated)
              <input value={form.to} onChange={(e) => set('to', e.target.value)}
                placeholder="ops@example.com, oncall@example.com" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              CC (optional)
              <input value={form.cc} onChange={(e) => set('cc', e.target.value)}
                placeholder="manager@example.com" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Subject prefix
              <input value={form.subject_prefix} onChange={(e) => set('subject_prefix', e.target.value)}
                placeholder="[Monitor Alert]" />
            </label>
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Channel enabled
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save channel'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Rule Form ──────────────────────────────────────────────────────────────
function RuleForm({ channels, servers, initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? {
    channel_id: channels[0]?.id ?? '',
    server_id: '',
    alert_type: '',
    severities: ['low', 'medium', 'high', 'critical'],
    on_open: true,
    on_resolve: false,
    cooldown_minutes: 30,
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleSev = (s) => {
    setForm((f) => ({
      ...f,
      severities: f.severities.includes(s) ? f.severities.filter((x) => x !== s) : [...f.severities, s],
    }));
  };

  const save = async () => {
    if (!form.channel_id) return setErr('Select a channel');
    if (form.severities.length === 0) return setErr('Select at least one severity');
    setSaving(true); setErr('');
    try {
      const body = {
        channel_id: form.channel_id,
        server_id: form.server_id || undefined,
        alert_type: form.alert_type || undefined,
        severities: form.severities,
        on_open: form.on_open,
        on_resolve: form.on_resolve,
        cooldown_minutes: Number(form.cooldown_minutes),
        enabled: form.enabled,
      };
      await onSave(body);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h4 style={{ marginBottom: 16 }}>{initial ? 'Edit Rule' : 'New Notification Rule'}</h4>
      {err && <div style={{ color: 'var(--crit)', marginBottom: 10, fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Channel
          <select value={form.channel_id} onChange={(e) => set('channel_id', e.target.value)}>
            <option value="">— select —</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Server (optional)
          <select value={form.server_id} onChange={(e) => set('server_id', e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Alert type (optional)
          <select value={form.alert_type} onChange={(e) => set('alert_type', e.target.value)}>
            {ALERT_TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Cool-down (minutes)
          <input type="number" min={0} value={form.cooldown_minutes}
            onChange={(e) => set('cooldown_minutes', e.target.value)} />
        </label>
      </div>

      {/* Severities */}
      <div style={{ marginTop: 12, fontSize: 13 }}>
        <div style={{ marginBottom: 6, color: 'var(--muted)' }}>Trigger on severities</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SEVERITIES.map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.severities.includes(s)} onChange={() => toggleSev(s)} />
              <SevPill s={s} />
            </label>
          ))}
        </div>
      </div>

      {/* Triggers */}
      <div style={{ marginTop: 12, fontSize: 13 }}>
        <div style={{ marginBottom: 6, color: 'var(--muted)' }}>Notify when</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.on_open} onChange={(e) => set('on_open', e.target.checked)} />
            Alert opens
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.on_resolve} onChange={(e) => set('on_resolve', e.target.checked)} />
            Alert resolves
          </label>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 12 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Rule enabled
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save rule'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const [channels, setChannels] = useState([]);
  const [rules, setRules] = useState([]);
  const [log, setLog] = useState([]);
  const [servers, setServers] = useState([]);
  const [tab, setTab] = useState('channels'); // 'channels' | 'rules' | 'log'
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editChannel, setEditChannel] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [testing, setTesting] = useState(null);
  const [toast, setToast] = useState('');

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    api.notifChannels().then(setChannels).catch(() => {});
    api.notifRules().then(setRules).catch(() => {});
    api.servers().then(setServers).catch(() => {});
  }, []);

  const loadLog = useCallback(() => {
    api.notifLog(200).then(setLog).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'log') loadLog(); }, [tab, loadLog]);

  // Channel actions
  const saveChannel = async (body) => {
    if (editChannel) {
      await api.updateChannel(editChannel.id, body);
      notify('Channel updated');
    } else {
      await api.createChannel(body);
      notify('Channel created');
    }
    setShowChannelForm(false); setEditChannel(null); load();
  };

  const delChannel = async (id) => {
    if (!confirm('Delete this channel and all its rules?')) return;
    await api.deleteChannel(id);
    notify('Channel deleted'); load();
  };

  const testChannel = async (ch) => {
    setTesting(ch.id);
    try {
      await api.testChannel(ch.id);
      notify(ch.type === 'discord'
        ? 'Test message posted to Discord'
        : `Test email sent to ${ch.config?.to}`);
    } catch (e) { notify(`Test failed: ${e.message}`); }
    setTesting(null);
  };

  const toggleChannel = async (ch) => {
    await api.updateChannel(ch.id, { enabled: !ch.enabled });
    load();
  };

  // Rule actions
  const saveRule = async (body) => {
    if (editRule) {
      await api.updateRule(editRule.id, body);
      notify('Rule updated');
    } else {
      await api.createRule(body);
      notify('Rule created');
    }
    setShowRuleForm(false); setEditRule(null); load();
  };

  const delRule = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await api.deleteRule(id);
    notify('Rule deleted'); load();
  };

  const toggleRule = async (rule) => {
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    load();
  };

  const startEditChannel = (ch) => {
    setEditChannel(ch);
    setShowChannelForm(true);
    setShowRuleForm(false);
  };

  const startEditRule = (r) => {
    setEditRule(r);
    setShowRuleForm(true);
    setShowChannelForm(false);
  };

  const channelInitial = editChannel ? {
    name: editChannel.name,
    type: editChannel.type ?? 'email',
    to: editChannel.config?.to ?? '',
    cc: editChannel.config?.cc ?? '',
    subject_prefix: editChannel.config?.subject_prefix ?? '[Monitor Alert]',
    webhook_url: editChannel.config?.webhook_url ?? '',
    username: editChannel.config?.username ?? 'Server Monitor',
    enabled: editChannel.enabled,
  } : null;

  const ruleInitial = editRule ? {
    channel_id: editRule.channel_id,
    server_id: editRule.server_id ?? '',
    alert_type: editRule.alert_type ?? '',
    severities: editRule.severities ?? SEVERITIES,
    on_open: editRule.on_open,
    on_resolve: editRule.on_resolve,
    cooldown_minutes: editRule.cooldown_minutes,
    enabled: editRule.enabled,
  } : null;

  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 9999,
          background: 'var(--accent)', color: '#fff', padding: '10px 18px',
          borderRadius: 8, fontSize: 13, boxShadow: '0 4px 16px #0004',
        }}>{toast}</div>
      )}

      <div className="page-head">
        <h2>Notifications</h2>
        <span className="muted">{channels.length} channel{channels.length !== 1 ? 's' : ''}, {rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {['channels', 'rules', 'log'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* ── CHANNELS TAB ── */}
      {tab === 'channels' && (
        <>
          {(showChannelForm) ? (
            <ChannelForm
              initial={channelInitial}
              onSave={saveChannel}
              onCancel={() => { setShowChannelForm(false); setEditChannel(null); }}
            />
          ) : (
            <button className="btn-primary" onClick={() => { setShowChannelForm(true); setEditChannel(null); }}
              style={{ marginBottom: 20 }}>
              + New channel
            </button>
          )}

          {channels.length === 0 && !showChannelForm && (
            <div className="empty" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>
              No channels yet. Create an email or Discord channel to start receiving alerts.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: showChannelForm ? 16 : 0 }}>
            {channels.map((ch) => (
              <div key={ch.id} className="card" style={{
                opacity: ch.enabled ? 1 : 0.6,
                borderLeft: `3px solid ${ch.enabled ? 'var(--accent)' : 'var(--border)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {ch.name}
                      <span style={{
                        marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '1px 7px',
                        borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)',
                        color: 'var(--muted)', textTransform: 'capitalize',
                      }}>{ch.type ?? 'email'}</span>
                    </div>
                    {ch.type === 'discord' ? (
                      <>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                          Webhook: <span style={{ color: 'var(--fg)' }}>
                            {(ch.config?.webhook_url ?? '').replace(/(\/[\w-]{6})[\w-]+$/, '$1…')}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          As: {ch.config?.username ?? 'Server Monitor'}
                          &nbsp;·&nbsp; {ch.rule_count ?? 0} rule{ch.rule_count !== 1 ? 's' : ''}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                          To: <span style={{ color: 'var(--fg)' }}>{ch.config?.to}</span>
                          {ch.config?.cc && <> &nbsp;·&nbsp; CC: {ch.config.cc}</>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          Prefix: {ch.config?.subject_prefix ?? '[Monitor Alert]'}
                          &nbsp;·&nbsp; {ch.rule_count ?? 0} rule{ch.rule_count !== 1 ? 's' : ''}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => testChannel(ch)} disabled={testing === ch.id}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6,
                        background: 'var(--panel-2)', border: '1px solid var(--border)',
                        cursor: 'pointer', color: 'var(--fg)' }}>
                      {testing === ch.id ? 'Sending…' : 'Test'}
                    </button>
                    <button onClick={() => startEditChannel(ch)}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6,
                        background: 'var(--panel-2)', border: '1px solid var(--border)',
                        cursor: 'pointer', color: 'var(--fg)' }}>Edit</button>
                    <button onClick={() => toggleChannel(ch)}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6,
                        background: ch.enabled ? '#fef3c7' : '#d1fae5',
                        border: '1px solid var(--border)', cursor: 'pointer',
                        color: ch.enabled ? '#92400e' : '#065f46' }}>
                      {ch.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => delChannel(ch.id)}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6,
                        background: '#fee2e2', border: '1px solid #fca5a5',
                        cursor: 'pointer', color: '#991b1b' }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── RULES TAB ── */}
      {tab === 'rules' && (
        <>
          {showRuleForm ? (
            <RuleForm
              channels={channels}
              servers={servers}
              initial={ruleInitial}
              onSave={saveRule}
              onCancel={() => { setShowRuleForm(false); setEditRule(null); }}
            />
          ) : (
            <button className="btn-primary"
              onClick={() => { setShowRuleForm(true); setEditRule(null); }}
              style={{ marginBottom: 20 }}
              disabled={channels.length === 0}>
              + New rule{channels.length === 0 ? ' (create a channel first)' : ''}
            </button>
          )}

          {rules.length === 0 && !showRuleForm && (
            <div className="empty" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>
              No rules yet. Rules define which alerts trigger a notification.
            </div>
          )}

          <div style={{ marginTop: showRuleForm ? 16 : 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Channel</th><th>Server</th><th>Alert type</th>
                    <th>Severities</th><th>Triggers</th><th>Cool-down</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                      <td><b>{r.channel_name}</b></td>
                      <td>{r.server_name ?? <span className="muted">All servers</span>}</td>
                      <td>{r.alert_type ?? <span className="muted">All types</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {(r.severities ?? SEVERITIES).map((s) => <SevPill key={s} s={s} />)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {r.on_open && <span style={{ color: '#f87171' }}>open</span>}
                        {r.on_open && r.on_resolve && ' · '}
                        {r.on_resolve && <span style={{ color: '#34d399' }}>resolve</span>}
                      </td>
                      <td>{r.cooldown_minutes}m</td>
                      <td>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: r.enabled ? '#d1fae5' : '#f3f4f6',
                          color: r.enabled ? '#065f46' : '#6b7280',
                        }}>{r.enabled ? 'enabled' : 'disabled'}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => startEditRule(r)}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5,
                              background: 'var(--panel-2)', border: '1px solid var(--border)',
                              cursor: 'pointer', color: 'var(--fg)' }}>Edit</button>
                          <button onClick={() => toggleRule(r)}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5,
                              background: r.enabled ? '#fef3c7' : '#d1fae5',
                              border: '1px solid var(--border)', cursor: 'pointer',
                              color: r.enabled ? '#92400e' : '#065f46' }}>
                            {r.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button onClick={() => delRule(r.id)}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5,
                              background: '#fee2e2', border: '1px solid #fca5a5',
                              cursor: 'pointer', color: '#991b1b' }}>Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr><td colSpan={8} className="empty">No rules configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── LOG TAB ── */}
      {tab === 'log' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-secondary" onClick={loadLog}>Refresh</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>When</th><th>Channel</th><th>Server</th>
                  <th>Alert type</th><th>Event</th><th>Status</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtDate(l.sent_at)}
                    </td>
                    <td>{l.channel_name ?? '—'}</td>
                    <td>{l.server_name ?? '—'}</td>
                    <td>{l.alert_type ?? '—'}</td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '2px 7px', borderRadius: 10,
                        background: l.event === 'open' ? '#fee2e2' : '#d1fae5',
                        color: l.event === 'open' ? '#991b1b' : '#065f46',
                        fontWeight: 600,
                      }}>{l.event}</span>
                    </td>
                    <td>
                      <StatusDot s={l.status} />
                      <span style={{ fontSize: 12 }}>{l.status}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--crit)' }}>{l.error ?? ''}</td>
                  </tr>
                ))}
                {log.length === 0 && (
                  <tr><td colSpan={7} className="empty">No notification history yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
